import { readFileSync } from "fs";
import Promise          from "bluebird";
import _                from "lodash";
import debug            from "debug";
import Jobs             from "@oada/jobs";
import tree             from "./tree.js";
import jsonpointer      from "jsonpointer";
import template         from "./email_templates/index.js";
import { v4 as uuidv4 } from "uuid";
import emailParser      from "email-addresses";
import config           from "./config.js";
import HashTable        from "simple-hashtable";
import moment           from "moment";
import Worker           from "@oada/rules-worker";
const { RulesWorker } = Worker;
const { Service }     = Jobs; 
const TN = "trellis-notifications";

const error = debug(`${TN}:error`);
const warn  = debug(`${TN}:warn`);
const info  = debug(`${TN}:info`);
const trace = debug(`${TN}:trace`);

const TOKEN = config.get('token');
let DOMAIN  = config.get('domain') || '';
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
  COI:   "coi",
  CERT:  "cert",
  LOG:   "log"
};

Object.freeze(DocType);

const Frequency = {
  DAILY: "daily",
  LIVEFEED: "live-feed"
};

Object.freeze(Frequency);

const doctypes = [ DocType.AUDIT, DocType.CERT, DocType.COI, DocType.LOG ];

// 5 min timeout
Promise.each(doctypes, async doctype => {
	trace("creating jobs for document type ", doctype);
  service.on(`${doctype}-changed`, config.get('timeout'), newJob);
});

let notifications = {};
let dailyNotifications = [];

async function newJob (job, { jobId, log, oada }) {
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
	const c                   = job.config;
	const _userEndpoint       = c.userEndpoint;
	const _emailsEndpoint     = c.emailsEndpoint;
	const _doctype            = c.doctype;
	let _destinationPath      = c.chroot;
	let _tnUserEndpoint       = ""; 
	let _emailsToNotify       = "";
	let _prefix               = "/bookmarks/trellisfw/";
	_tnUserEndpoint           = _prefix + _destinationPath + '/' + _userEndpoint;
	_emailsToNotify           = _prefix + _destinationPath + "/" + _emailsEndpoint;
	let _notificationsConfig  = _prefix + _destinationPath;
	trace('Final destinationPath = ', _destinationPath);

  const _emails = await oada
		.get( { path: _emailsToNotify })
		.then( r => r.data )
	  .catch( e => {
        throw new Error("Failed to retrieve emails to notify, error " + e);
		});
	
	//notify according to rules/config
  let _config = await notifyUser( {oada, _tnUserEndpoint, _emailsToNotify,
		                               _notificationsConfig, _emails, job} );
	
  return _config; 
}

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
}

/**
 * notifyUser: notifies user according to rules
*/
async function notifyUser( {oada, _tnUserEndpoint, _emailsToNotify, _notificationsConfig,
	                          _emails, job} ) {
  trace('--> Notify User ', job.config.doctype);

	let _tradingPartnerId = job.config.chroot.replace(/^.*trading-partners\/([^\/]+)(\/.*)$/, '$1');

	const _docType = job.config.doctype;
	const _userToken = uuidv4().replace(/-/g, '');

	const _data = {
    clientId:   "SERVICE-CLIENT-TRELLIS-NOTIFICATIONS",
		user:       { _id: job.config.user.id },
		token:      _userToken,
		scope:      ["all:all"],
		createTime: Date.now(),
		expiresIn:  90 * 24 * 3600 * 1000
	};
	
	const _auth = await oada.
			post({
				path:    "/authorizations",
				data:    _data,
				headers: { "content-type": "application/vnd.oada.authorization.1+json" }
			})
			.then( r => r.data )
			.catch(e => {
				info('FAILED to post to /authorizations user ', job.config.user.id,', error ', e);
				throw e;
			});

	let _to = emailParser.parseAddressList(_emails).map(( {name, address} ) => 
								     ({
								        name:  name || undefined,
								        email: address
							       }));

  const _notificationsConfigData = await oada
		.get( { path: _notificationsConfig })
		.then( r => r.data )
	  .catch( e => {
        throw new Error("Failed to retrieve notifications config, error " + e);
		});

	let _emailsConfig = _notificationsConfigData["notifications-config"];
	let _configTemplate = {
    id:        "",
		type:      "email",
		frequency: ""
	};

	if (_to) {
		_to.forEach( function(item) {
			_configTemplate.id = item.email;
			if (_emailsConfig[item.email] && _emailsConfig[item.email].frequency) {
			  _configTemplate.frequency = _emailsConfig[item.email].frequency;
			} else {
				_configTemplate.frequency = Frequency.LIVEFEED;
			}
      notifications[item.email]        = {};
			notifications[item.email].config = {};
			notifications[item.email].config = _configTemplate;
		});
	}

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
	
  const jobkey = await oada
	      .post({
					path: "/resources",
					data: _resourceData	
				})
	      .then( r => r.headers["content-location"].replace(/^\/resources\//, '') )
	      .catch( e => {
            throw new Error("Failed to create resource, error " + e);
		     });

	// Link into abalonemail queue
  await oada.put({
    path: `/bookmarks/services/abalonemail/jobs`,
    data: { [jobkey]: { _id: `resources/${jobkey}` } },
    tree
  });

	let _date = moment().format('YYYY-MM-DD');
	// Link into notifications index
	// TODO: Use for daily configuration, to be integrated with rules-engine 
  /*await oada.put({
    path: `/bookmarks/services/${TN}/notifications/day-index/${_date}`,
    data: { "servio@palacios.com": { count: 1 }  }
  });*/
	
	let _config = { 
		result:           "success",
		destinationPath:  _tnUserEndpoint,
		tnUserEndpoint:   _tnUserEndpoint,
		emailsToNotify:   _emailsToNotify,
		emails:           _emails,
		tradingPartnerId: _tradingPartnerId,
		data:             _data,
		jobkey:           jobkey,
		resourceData:     _resourceData,
		notifications:    notifications
	};

	return _config;
}

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
