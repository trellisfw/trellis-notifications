import Promise from "bluebird";
import _ from "lodash";
import debug from "debug";
import Jobs from "@oada/jobs";
import tree from "./tree.js";
import template from "./email_templates/index.js";
import config from "./config.js";
import Worker from "@trellisfw/rules-worker";
const { RulesWorker, Action, Condition } = Worker;
import Cron from "cron";
const { CronJob } = Cron;

// Notifications helper
import { DocType, Frequency, NotificationType, docTypes, rulesEngineOptions, notifications, dailyNotifications } from "./src/notifications.js";
import { DAILY_4PM, userConfig } from "./src/notifications.js";
import Notifications from "./src/notifications.js";

const { Service } = Jobs;
const TN = "trellis-notifications";
let OADA = null;
Object.freeze(DocType);
Object.freeze(Frequency);

let _CRONCounter = 0;

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
		// {
		// 	type: 'slack',
		// 	status: 'failure',
		// 	posturl: config.get('slackposturl')
		// }
	]
}); // 1 concurrent job

/**
 * sets up a CRON job for the daily/hourly/etc. notifications
 */
//TODO: should trigger this:dailyDigest() when time arrives
var cronJob = new CronJob(DAILY_4PM, async function () {
	console.log("[Cron] --> triggered new daily job.");
	try {
		if (OADA !== null) {
			dailyDigest();
		}
	}
	catch (e) {
		throw new Error("CRON Job failed " + e);
	}
}, null, true, 'America/Indiana/Indianapolis');

cronJob.start();

/**
 * Daily Digest Main Function
 */
async function dailyDigest() {
	if (OADA !== null) {
		try {
			let _dailyDigest = await Notifications.getDailyDigest(OADA);
			console.log("--> getting dailyDigest() ", _dailyDigest);
			let _dailyDigestQueue = null;
			if (_dailyDigest) {
				_dailyDigestQueue = _dailyDigest["daily-digest-queue"];
			}

			if (_dailyDigest && (!_dailyDigest.hasOwnProperty("processed") || !_dailyDigest.processed)) {

				for (let _email of Object.keys(_dailyDigestQueue)) {
					let _userToken = "";
					let _docType = "";
					if (_dailyDigestQueue[_email].length >= 2) {
						_docType = DocType.ALL;
					} else {
						_docType = _dailyDigestQueue[_email][0].docType;
					}//if

					//for (let _notification in _dailyDigestQueue[_email]) {
					_userToken = _dailyDigestQueue[_email][0].userToken;
					//} //for #2
					//await createEmailJob(OADA, _docType, _email, _email, _userToken);
				}//for

				await Notifications.markDailyDigestAsCompleted(OADA);

				Notifications.flushDailyNotifications();
			} else if (!_dailyDigest) {//if dailyDigest queue does not exist for this day, create one
				await Notifications.createDailyDigest(OADA, _content);
			}
		} catch (error) {
			throw new Error("--> dailyDigest(): Error when getting the daily digest queue", error);
		};
	}//if
}//end daily digest

// ======================================================================================
// creates type of services served
// ======================================================================================
Promise.each(docTypes, async docType => {
	trace("creating jobs for document type ", docType);
	service.on(`${docType}-changed`, config.get('timeout'), newJob);
});

/**
 * newJob handler
 * @param job 
 * @param param1 
 */
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
	OADA = oada;
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
	let _config = await Notifications.notifyUser({
		oada, _tnUserEndpoint, _emailsToNotify,
		_notificationsConfig, _emails, job, notifications
	});

	return _config;
}//end newJob

// ==================================================================================
// > rule event triggered
// ==================================================================================
service.on(`rule-event-triggered`, config.get('timeout'), newRuleGeneratedJob);

/**
 * newRuleGeneratedJob handler
 * @param job 
 * @param param1 
 */
async function newRuleGeneratedJob(job, { jobId, log, oada }) {
	console.log("--> received job creation for rule-event-triggered");
	OADA = oada;
	let _emailsToNotify = job.config.emailsToNotify || "";
	let _config = await ruleNotifyUser(oada, _emailsToNotify, job);
	return _config;
}//end newJob

/**
 * Inserts into the daily digest endpoint in the notifications service
 * keeps track of the notifications that are needed to send at the end of the day
 * @param notifications --> object with configuration for notifications
 */
async function insertDailyDigestQueue(oada, notifications, _userToken) {
	let _entries = Object.entries(notifications);
	let _result = {};

	for (const [email, notification] of _entries) {
		if (notification.config.frequency === Frequency.DAILY_FEED) {
			let _userNotifications = [];
			if (dailyNotifications[email]) {
				//copying previous array of notifications
				_userNotifications = dailyNotifications[email].notifications;
			} else {
				//initialize the hash table entry
				dailyNotifications[email] = {};
				dailyNotifications[email].notifications = [];
				dailyNotifications[email].id = email;
				dailyNotifications[email].processed = false;
			}// if
			_result[email] = {};
			let _userNotification = {
				docType: notification.config.docType,
				userToken: _userToken
			};
			//let _userNotifications = [];
			_userNotifications.push(_userNotification);
			_result[email] = {
				id: email,
				notifications: _userNotifications,
				processed: false
			};
			dailyNotifications[email].notifications = _userNotifications;
		}//if
	}//for

	let _path = Notifications.getDailyDigestPath();
	let _notificationsHT = {
		notificationsHT: _result
	};

	await oada.put({
		path: _path,
		data: _notificationsHT
	});

	return _result;
}//end insertDailyDigestQueue

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
async function createEmailJob(oada, _docType, _to, _emails, _userToken) {
	console.log("--> createEmailJob #0", _emails);
	let _subject = Notifications.getSubject(_docType);
	let _token = ``;
	let _link = `https://trellisfw.github.io/conductor?d=${DOMAIN}&t=${_token}&s=${SKIN}`;

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

	console.log("--> createEmailJob #1 jobkey", _jobkey);

	return _jobkey;
}//end createEmailJob

/**
 * ruleNotifyUser: notifies user according to rules
 * @param param0 
 */
async function ruleNotifyUser(oada, emails, job) {
	console.log("--> ruleNotifyUser #0", emails);
	const _userToken = Notifications.generateToken();
	//const _auth = await getAuthorization(oada, job, _userToken);
	let _to = "";
	if (Array.isArray(emails)) {
		_to = emails.join();
	} else {
		_to = Notifications.parseEmails(emails);
	}
	console.log("--> ruleNotifyUser #1 to: ", _to);
	let _jobkey = await createEmailJob(oada, DocType.AUDIT, _to, emails, _userToken);
	let _config = {
		result: "success",
		emailsToNotify: emails,
		jobkey: _jobkey
	};

	return _config;
}//end ruleNotifyUser

// ============================================================================
// starting trellis-notification service
// ============================================================================
console.log("--> starting trellis-notifications service");
service.start().catch(e => console.error('Service threw uncaught error: ', e));

// local connection
const _conn = service.getClient(DOMAIN).clone(TOKEN);
OADA = _conn;

/**
 * creates a trellis-notification job when callback is triggered
 * callback utilized in the rules-engine configuration
 * @param item 
 * @param options 
 */
async function createTNJob(item, options) {
	console.log("--> creating tn job - callback for the rules-engine");
	console.log("--> item ", item);
	console.log("--> options", options);
	let _emails = options.emailsToNotify ? options.emailsToNotify : "trellis-testing@centricity.us";
	let _content = {
		service: "trellis-notifications",
		type: `rule-event-triggered`,
		config: {
			docType: DocType.AUDIT,
			emailsToNotify: _emails
		}
	};

	const _key = await OADA
		.post({
			path: "/resources",
			data: _content
		})
		.then(r => r.headers["content-location"].replace(/^\/resources\//, ''))
		.catch(e => {
			throw new Error("Failed to create resource, error " + e);
		});

	// Link into trellis-notifications queue
	await OADA.put({
		path: `/bookmarks/services/trellis-notifications/jobs`,
		data: { [_key]: { _id: `resources/${_key}` } },
		tree
	});
}//createTNJob

/** ============================================================================
 *  rules-engine configuration
 *  rules-engine - set of actions related to trellis-notifications
 *  ============================================================================ 
*/
new RulesWorker({
	name: "trellis-notifications",
	conn: service.getClient(DOMAIN).clone(TOKEN),
	actions: [
		Action({
			name: "notify-emails-livefeed",
			service: "trellis-notifications",
			type: "application/json",
			description: "send {notificationType} notifications to {emailsToNotify}",
			params: rulesEngineOptions,
			callback: createTNJob
		})
	]
});
