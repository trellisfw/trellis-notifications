import { readFileSync } from "fs";
import Promise          from "bluebird";
import _                from "lodash";
import debug            from "debug";
import Jobs             from "@oada/jobs";
import tree             from "./tree.js";
import jsonpointer      from "json-pointer";
import template         from "./email_templates/index.js";
import { v4 as uuidv4 } from "uuid";
import addrs            from "email-addresses";

import config from "./config.js";

const { Service } = Jobs // no idea why I have to do it this way

const error = debug('trellis-notifications:error');
const warn = debug('trellis-notifications:warn');
const info = debug('trellis-notifications:info');
const trace = debug('trellis-notifications:trace');

const TOKEN = config.get('token');
let DOMAIN = config.get('domain') || '';
if (DOMAIN.match(/^http/)) DOMAIN = DOMAIN.replace(/^https:\/\//, '')

if (DOMAIN === 'localhost' || DOMAIN === 'proxy') {
  process.env.NODE_TLS_REJECT_UNAUTHORIZED = 0
}

const SKIN = config.get('skin') || 'default'

const service = new Service('trellis-notifications', DOMAIN, TOKEN, 1, {
  finishReporters: [
    {
      type: 'slack',
      status: 'failure',
      posturl: config.get('slackposturl')
    }
  ]
}) // 1 concurrent job

// 5 min timeout
service.on('audit-changed',                config.get('timeout'), newJob)
service.on('certificate-changed',          config.get('timeout'), newJob)
service.on('coi-changed',                  config.get('timeout'), newJob)
service.on('letters-of-guarantee-changed', config.get('timeout'), newJob)

async function newJob (job, { jobId, log, oada }) {
  // until oada-jobs adds cross-linking, make sure we are linked under pdf's jobs
  trace('Linking job under src/_meta until oada-jobs can do that natively')
  await oada.put({
    path: `${job.config.src}/_meta/services/trellis-notifications/jobs`,
    data: {
      [jobId]: { _ref: `resources/${jobId}` }
    }
  })

  // Find the net dest path, taking into consideration chroot
  const dest = job.config.dest
  let destpath = dest
  let chroot = ''
  if (job.config.chroot) {
    chroot = job.config.chroot
    chroot = chroot.replace(/\/$/, '') // no trailing slash
    if (chroot.match(/\/bookmarks$/)) {
      trace(
        'chroot exists and ends in bookmarks, getting rid of bookmarks part'
      )
      chroot = chroot.replace(/\/bookmarks$/, '')
    }
    destpath = `${chroot}${destpath}`
    trace('Final destpath = ', destpath)
  }

  const tree = job.config.tree

	//TODO
	//need to include abalonemail jobs
  //if (!job.config.skipCreatingEmailJobs) {
    // this flag is mainly for testing
    // HARDCODED UNTIL AINZ CAN DO THIS INSTEAD
    //await createEmailJobs({ oada, job })
  //}

  return job.config // for lack of something better to put in the result...
}

async createEmailJobs( {oada, job} ) {

}

service.start().catch(e => console.error('Service threw uncaught error: ', e))
