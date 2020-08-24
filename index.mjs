import { readFileSync } from "fs";
import Promise          from "bluebird";
import _                from "lodash";
import debug            from "debug";
import Jobs             from "@oada/jobs";
import tree             from "./tree.js";
import jsonpointer      from "jsonpointer";
import template         from "./email_templates/index.js";
import { v4 as uuidv4 } from "uuid";
import emailParser            from "email-addresses";
import config           from "./config.js";
import HashTable        from "simple-hashtable";
const { Service } = Jobs 

const error = debug('trellis-notifications:error');
const warn  = debug('trellis-notifications:warn');
const info  = debug('trellis-notifications:info');
const trace = debug('trellis-notifications:trace');

const TOKEN = config.get('token');
let DOMAIN = config.get('domain') || '';
if (DOMAIN.match(/^http/)) DOMAIN = DOMAIN.replace(/^https:\/\//, '')

if (DOMAIN === 'localhost' || DOMAIN === 'proxy') {
  process.env.NODE_TLS_REJECT_UNAUTHORIZED = 0
}

const SKIN = config.get('skin') || 'default';

const service = new Service('trellis-notifications', DOMAIN, TOKEN, 1, {
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

const doctypes = [ DocType.AUDIT, DocType.CERT, DocType.COI, DocType.LOG ];

// 5 min timeout
Promise.each(doctypes, async doctype => {
	trace("creating jobs for document type ", doctype);
  service.on(`${doctype}-changed`, config.get('timeout'), newJob);
});

async function newJob (job, { jobId, log, oada }) {
  /*
	trace('Linking job under src/_meta until oada-jobs can do that natively')
	
  await oada.put({
    path: `${job.config.src}/_meta/services/trellis-notifications/jobs`,
    data: {
      [jobId]: { _ref: `resources/${jobId}` }
    }
  })
	*/

  // Find the net destination path, taking into consideration chroot
	const _userEndpoint   = job.config.userEndpoint;
	const _emailsEndpoint = job.config.emailsEndpoint;
	const _doctype        = job.config.doctype;
	let _destinationPath  = job.config.chroot;
	let _tnUserEndpoint   = ""; 
	let _emailsToNotify   = "";
	let _prefix           = "/bookmarks/trellisfw/";
	_tnUserEndpoint       = _prefix + _destinationPath + '/' + _userEndpoint;
	_emailsToNotify       = _prefix + _destinationPath + "/" + _emailsEndpoint;
	trace('Final destinationPath = ', _destinationPath);

  const _emails = await oada
		.get( { path: _emailsToNotify })
		.then( r => r.data )
	  .catch( e => {
			if ( !e ) {
        throw new Error("Failed to retrieve emails to notify");
			}//if
			return 0;
		});
	
	//notify according to rules/config
  let _config = await notifyUser( {oada, _tnUserEndpoint, _emailsToNotify,
		                               _emails, job} );
	
  return _config; 
}

/**
 * notifyUser: notifies user according to rules
*/
async function notifyUser( {oada, _tnUserEndpoint, _emailsToNotify, _emails, job} ) {
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
/*
 * FIXME: need to retrieve token
	const _auth = await oada.
			post({
				path:    "/authorizations",
				data:    _data,
				headers: { "content-type": "application/vnd.oada.authorization.1+json" }
			})
			.then( r => r.data )
			.catch(e => {
				info('FAILED to post to /authorizations user ', job.config.user.id,', error ', e)
				throw e
			});
*/

	let _to = emailParser.parseAddressList(_emails).map(( {name, address} ) => 
								     ({
								        name:  name || undefined,
								        email: address
							       }));

	let _subject = "New FSQA audit available";
	
	switch (_docType) {
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
								link: "link"
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
			     if ( !e ) {
             throw new Error("Failed to create resource");
			     }//if
			     return 0;
		     });

	// Link into abalonemail queue
  await oada.put({
    path: `/bookmarks/services/abalonemail/jobs`,
    data: { [jobkey]: { _id: `resources/${jobkey}` } },
    tree
  });
	
	let _config = { 
		result: "success",
		destinationPath:  _tnUserEndpoint,
		tnUserEndpoint:   _tnUserEndpoint,
		emailsToNotify:   _emailsToNotify,
		emails:           _emails,
		tradingPartnerId: _tradingPartnerId,
		data:             _data,
		jobkey:           jobkey,
		resourceData:     _resourceData
	};

	//let _config = { authorization: _authorizationData, docType: _docType, auth: _auth };

	return _config;
}

async function createEmailJobs( {oada, job} ) {

}

service.start().catch(e => console.error('Service threw uncaught error: ', e))
