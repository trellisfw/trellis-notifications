import { readFileSync } from "fs";
import Promise from "bluebird";
import _ from "lodash";
import debug from "debug";
import Jobs from "@oada/jobs";
import tree from "./tree.js";
import jsonpointer from "jsonpointer";
import template from "./email_templates/index.js";
import { v4 as uuidv4 } from "uuid";
import emailParser from "email-addresses";
import config from "./config.js";
import moment from "moment";
import Worker from "@oada/rules-worker";
const { RulesWorker } = Worker;
const { Service } = Jobs;
const TN = "trellis-notifications";

const error = debug(`${TN}:error`);
const warn = debug(`${TN}:warn`);
const info = debug(`${TN}:info`);
const trace = debug(`${TN}:trace`);

const TOKEN = config.get('token');
let DOMAIN = config.get('domain') || '';
if (DOMAIN.match(/^http/)) DOMAIN = DOMAIN.replace(/^https:\/\//, '')

if (DOMAIN === 'localhost' || DOMAIN === 'proxy') {
	process.env.NODE_TLS_REJECT_UNAUTHORIZED = 0
}

const SKIN = config.get('skin') || 'default';

const service = new Service(TN, DOMAIN, TOKEN, 1, {
	finishReporters: [
		{
			type: 'slack',
			status: 'failure',
			posturl: config.get('slackposturl')
		}
	]
}) // 1 concurrent job

const DocType = {
	AUDIT: "audit",
	COI: "coi",
	CERT: "cert",
	LOG: "log"
};

Object.freeze(DocType);

const Frequency = {
	DAILYFEED: "daily-feed",
	LIVEFEED: "live-feed"
};

Object.freeze(Frequency);

const doctypes = [DocType.AUDIT, DocType.CERT, DocType.COI, DocType.LOG];

// 5 min timeout
Promise.each(doctypes, async doctype => {
	trace("creating jobs for document type ", doctype);
	service.on(`${doctype}-changed`, config.get('timeout'), newJob);
});

let notifications = {};
let dailyNotifications = [];

async function newJob(job, { jobId, log, oada }) {
  /*
	trace('Linking job under src/_meta until oada-jobs can do that natively')
  //debugging
//
  await oada.put({
    path: `${job.config.src}/_meta/services/${TN}/jobs`,
    data: {
      [jobId]: { _ref: `resources/${jobId}` }
    }
  })
	*/

	// Find the net destination path, taking into consideration chroot
	const c = job.config;
	const _userEndpoint = c.userEndpoint;
	const _emailsEndpoint = c.emailsEndpoint;
	const _doctype = c.doctype;
	let _destinationPath = c.chroot;
	let _tnUserEndpoint = "";
	let _emailsToNotify = "";
	let _prefix = "/bookmarks/trellisfw/";
	_tnUserEndpoint = _prefix + _destinationPath + '/' + _userEndpoint;
	_emailsToNotify = _prefix + _destinationPath + "/" + _emailsEndpoint;
	let _notificationsConfig = _prefix + _destinationPath;
	trace('Final destinationPath = ', _destinationPath);

	const _emails = await oada
		.get({ path: _emailsToNotify })
		.then(r => r.data)
		.catch(e => {
			throw new Error("Failed to retrieve emails to notify, error " + e);
		});

	//notify according to rules/config
	let _config = await notifyUser({
		oada, _tnUserEndpoint, _emailsToNotify,
		_notificationsConfig, _emails, job
	});

	return _config;
}//end newJob

/**
 * Inserts into the daily digest endpoint in the notifications service
 * @param notifications --> object with configuration for notifications
 */
async function insertDailyDigestQueue(oada, notifications) {
	let _entries = Object.entries(notifications);
	let _result = {};

	for (const [email, notification] of _entries) {
		if (notification.config.frequency === Frequency.DAILYFEED) {
			_result[email] = {};
			_result[email] = {
				id: email,
				processed: false,
				"doc1": "configuration for doc1",
				"doc2": "configuration for doc2"
			};
		}//if
	}//for

	let _date = moment().format('YYYY-MM-DD');
	// Link into notifications index
	// TODO: Use for daily configuration, to be integrated with rules-engine 
	// populates the trellis-notifications daily-feed queue
	await oada.put({
		path: `/bookmarks/services/${TN}/notifications/day-index/${_date}/daily-digest-queue`,
		data: _result
	});

	return _result;
}//end insertDailyDigestQueue

/**
 * Generates the subject to be sent by the notification service
 * @param docType -> type of document
 */
function getSubject(docType) {
	let _subject = "New FSQA audit available";

	switch (docType) {
		case DocType.CERT:
			_subject = "New FSQA certificate available";
			break;
		case DocType.COI:
			_subject = "New certificate of insurance available";
			break;
		case DocType.LOG:
			_subject = "New letter of guarantee available";
			break;
		case DocType.AUDIT:
			_subject = "New FSQA audit available";
			break;
		default:
			throw new Error("Document type not recognized");
	}//switch

	return _subject;
}//end getSubject

/**
 * Gets temporal authorization
 * @param oada --> oada client
 * @param job --> job configuration
 * @param _userToken --> user generated token
 */
async function getAuthorization(oada, job, _userToken) {
	const _data = {
		clientId: "SERVICE-CLIENT-TRELLIS-NOTIFICATIONS",
		user: { _id: job.config.user.id },
		token: _userToken,
		scope: ["all:all"],
		createTime: Date.now(),
		expiresIn: 90 * 24 * 3600 * 1000
	};

	const _auth = await oada.
		post({
			path: "/authorizations",
			data: _data,
			headers: { "content-type": "application/vnd.oada.authorization.1+json" }
		})
		.then(r => r.data)
		.catch(e => {
			info('FAILED to post to /authorizations user ', job.config.user.id, ', error ', e);
			throw e;
		});

	return _auth;
}// end getAuthorization

/**
 * Gets the Notification Config Data from endpoint (required)
 * @param oada --> oada client
 * @param _notificationsConfig --> path to the configuration for notifications 
 */
async function getNotificationConfigData(oada, _notificationsConfig) {
	return await oada
		.get({ path: _notificationsConfig })
		.then(r => r.data)
		.catch(e => {
			throw new Error("Failed to retrieve notifications config, error " + e);
		});
}//end getNotificationConfigData

/**
 * Creates a job for email notifications
 * @param oada 
 * @param _docType 
 * @param _to 
 * @param _emails 
 */
async function createEmailJob(oada, _docType, _to, _emails) {
	let _subject = getSubject(_docType);
	let _link = `https://trellisfw.github.io/conductor?d=${DOMAIN}&t=${TOKEN}&s=${SKIN}`;

	let _resourceData = {
		service: "abalonemail",
		type: "email",
		config: {
			multiple: false,
			to: _to,
			from: "info@dev.trellis.one",
			subject: `[Trellis Notification] - [${_subject}]`,
			templateData: {
				recipients: _emails,
				link: _link
			},
			html: template.html,
			attachments: template.attachments
		}
	};

	const _jobkey = await oada
		.post({
			path: "/resources",
			data: _resourceData
		})
		.then(r => r.headers["content-location"].replace(/^\/resources\//, ''))
		.catch(e => {
			throw new Error("Failed to create resource, error " + e);
		});

	// Link into abalonemail queue
	await oada.put({
		path: `/bookmarks/services/abalonemail/jobs`,
		data: { [_jobkey]: { _id: `resources/${_jobkey}` } },
		tree
	});

	return _jobkey;
}//end createEmailJob

/**
 * Populates the values for all notifications in the config
 * @param _to 
 * @param _notificationsConfigData 
 */
function populateNotifications(_to, _notificationsConfigData) {
	let _emailsConfig = _notificationsConfigData["notifications-config"];
	let _configTemplate = {
		id: "",
		type: "email",
		frequency: ""
	};

	if (_to) {
		_to.forEach(function (item) {
			let _template = _.cloneDeep(_configTemplate);
			_template.id = item.email;
			if (_emailsConfig[item.email] && _emailsConfig[item.email].frequency) {
				_template.frequency = _emailsConfig[item.email].frequency;
			} else {
				_template.frequency = Frequency.LIVEFEED;
			}
			notifications[item.email] = {};
			notifications[item.email].config = {};
			notifications[item.email].config = _template;
		});
	}
}//end populateNotifications

/**
 * Parses the emails to notify
 * @param _emails 
 */
function parseEmails(_emails) {
	return emailParser.parseAddressList(_emails).map(({ name, address }) =>
		({
			name: name || undefined,
			email: address
		}));
}//end parseEmails

/**
 * Gets the LIVEFEED Emails from notifications
 */
function getLiveFeedEmails() {
	let _entries = Object.entries(notifications);
	let _counter = 0;
	let _result = "";
	let _emails = "";

	for (const [email, notification] of _entries) {
		if (notification.config.frequency === Frequency.LIVEFEED) {
			_result += email + ",";
			_counter++;
		}//if
	}//for

	if (_counter > 0) {
		_emails = _result.substring(0, _result.length - 1);
	}

	return _emails;
}//end getLiveFeedEmails

/**
 * notifyUser: notifies user according to rules
 * @param param0 
 */
async function notifyUser({ oada, _tnUserEndpoint, _emailsToNotify, _notificationsConfig,
	_emails, job }) {
	trace('--> Notify User ', job.config.doctype);
	let _tradingPartnerId = job.config.chroot.replace(/^.*trading-partners\/([^\/]+)(\/.*)$/, '$1');
	const _docType = job.config.doctype;
	const _userToken = uuidv4().replace(/-/g, '');
	const _auth = await getAuthorization(oada, job, _userToken);
	const _notificationsConfigData = await getNotificationConfigData(oada, _notificationsConfig);
	let _to = parseEmails(_emails);
	populateNotifications(_to, _notificationsConfigData);
	let _list = await insertDailyDigestQueue(oada, notifications);
	let _livefeedEmails = getLiveFeedEmails();
	let _jobkey = await createEmailJob(oada, _docType, _livefeedEmails, _emails);

	let _config = {
		result: "success",
		destinationPath: _tnUserEndpoint,
		tnUserEndpoint: _tnUserEndpoint,
		emailsToNotify: _emailsToNotify,
		emails: _emails,
		liveFeeEmails: _livefeedEmails,
		tradingPartnerId: _tradingPartnerId,
		jobkey: _jobkey,
		notifications: notifications,
		dailyDigest: _list
	};

	return _config;
}//end notifyUser

service.start().catch(e => console.error('Service threw uncaught error: ', e))

/*
*TODO: define a set of actions related to trellis-notifications
*
*/
/*
new RulesWorker({
	name: "trellis-notifications",
  conn: service.getClient(DOMAIN).clone(TOKEN),
  actions: [
		{
			name:        "notify-fsqa-emails",
			service:     "trellis-notifications",
			type:        "application/json",
			description: "send a notification",
		  notifyUser
		}
  ]
});*/
