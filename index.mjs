import { readFileSync } from "fs";
import Promise          from "bluebird";
import _                from "lodash";
import debug            from "debug";
import Jobs             from "@oada/jobs";
import tree             from "./tree.js";
import jsonpointer      from "jsonpointer";
import template         from "./email_templates/index.js";
import { v4 as uuidv4 } from "uuid";
import addrs            from "email-addresses";
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
  trace('Linking job under src/_meta until oada-jobs can do that natively')
  await oada.put({
    path: `${job.config.src}/_meta/services/trellis-notifications/jobs`,
    data: {
      [jobId]: { _ref: `resources/${jobId}` }
    }
  })

  // Find the net destination path, taking into consideration chroot
  const _destination    = job.config.dest;
	const _docendpoint    = job.config.docendpoint;
	const _emailsendpoint = job.config.emailsendpoint;
	const _doctype        = job.config.doctype;
  let _destinationPath  = destination;
  let _chroot = '';
	let _endpointToWatch = ''; 
	let _emailsToNotify = '';
  if (job.config.chroot) {
    _chroot = job.config.chroot;
    _chroot = _chroot.replace(/\/$/, '');
    if (chroot.match(/\/bookmarks$/)) {
      trace(
        'chroot exists and ends in bookmarks, getting rid of bookmarks part'
      )
      _chroot = chroot.replace(/\/bookmarks$/, '');
    }
    _destinationPath = `${_chroot}${_destinationPath}`;
		_endpointToWatch = _destinationPath + '/' + docendpoint;
		_emailsToNotify = _endpointToWatch + _emailsendpoint;
    trace('Final destinationPath = ', _destinationPath);
  }
  const _emails = await oada
		.get( { path: _emailsToNotify })
		.then( r => r.data )
	  .catch( e => {
			if ( !e || e.status !== 404) {
        throw new 
					 Error("Failed to retrieve emails to notify, non-404 error status returned")
			}//if
			return 0;
		});
  const tree = job.config.tree;
	
	//TODO
	//notify according to rules/config
  await notifyUser( {oada, _endpointToWatch, _doctype, _emails} );

  return job.config; 
}


async function notifyUser( {oada, _endpointToWatch, _doctype, _emails} ) {

}

async function createEmailJobs( {oada, job} ) {

}

/*
async watchForDocChanges( {oada, path, doctype, emails, config} ) {

	const watch = new ListWatch({
    path: path,
		name: 'Alice',
		conn: oada,
		resume: true,
		onAddItem(item, id) {console.log("New " + doctype + " id " + id + " item " + item)},
		onRemoveItem(id) { console.log(`${doctype} ${id} removed`)}
	});

	await watch.stop();

	//TODO
	//need to include abalonemail jobs
  if (!config.skipCreatingEmailJobs) {
    await createEmailJobs({ oada, job });
  }
}
*/
service.start().catch(e => console.error('Service threw uncaught error: ', e))
