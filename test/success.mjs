import _ from "lodash";
import chai from "chai";
import chaiAsPromised from "chai-as-promised";
import oada from "@oada/client";
import Promise from "bluebird";
import moment from "moment";
import debug from "debug";
import jp from "jsonpointer";
import emailParser from "email-addresses";

const trace = debug('trellis-notifications#test:trace');
const info = debug('trellis-notifications#test:info');
const error = debug('trellis-notifications#test:error');

let con = false; // set with setConnection function
let _target = "trellis-notifications";

const tree = {
  bookmarks: {
    _type: 'application/vnd.oada.bookmarks.1+json',
    services: {
      _type: 'application/vnd.oada.services.1+json',
      "trellis-notifications": {
        _type: 'application/vnd.oada.service.1+json',
        jobs: {
          _type: 'application/vnd.oada.jobs.1+json',
          '*': {
            _type: 'application/vnd.oada.job.1+json',
          },
        },
        'jobs-success': {
          _type: 'application/vnd.oada.jobs.1+json',
          '*': {
            _type: 'application/vnd.oada.job.1+json',
          },
        },
        'jobs-failure': {
          _type: 'application/vnd.oada.jobs.1+json',
          '*': {
            _type: 'application/vnd.oada.job.1+json',
          },
        }
      }
    },
    trellisfw: {
      _type: 'application/vnd.trellisfw.1+json',
    },
  },
};

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

// Fill out tree, and let code fill in any "defaults" later.
// One "item" will have:
// name.singular, name.plural, data, source (oada|trellisfw), 
// list, _type, list_type, and key.
const day = moment().format('YYYY-MM-DD');
const jobtemplate = {
  source: 'oada',
  name: { singular: 'job' },
  list: `/bookmarks/services/${_target}/jobs`,
  notversioned: true, // do not make this a versioned link in it's list
  cleanup: {
    lists: [
      `/bookmarks/services/${_target}/jobs-success/day-index/${day}`,
      `/bookmarks/services/${_target}/jobs-failure/day-index/${day}`,
    ]
  },
};

let _emails = "servio@palacios.com,serviopalacios@gmail.com,servio@qlever.io,spock@startrek.com";
let _emailsConfig = {
  'servio@palacios.com': {
    frequency: Frequency.LIVEFEED
  },
  'serviopalacios@gmail.com': {
    frequency: Frequency.LIVEFEED
  },
  'servio@qlever.io': {
    frequency: Frequency.DAILYFEED
  },
  'spock@startrek.com': {
    frequency: Frequency.DAILYFEED
  }
};

const items = {
  coijob: _.cloneDeep(jobtemplate),
  auditjob: _.cloneDeep(jobtemplate),
  certjob: _.cloneDeep(jobtemplate),
  logjob: _.cloneDeep(jobtemplate),

  //-------------------------------------
  // Documents:
  pdf: {
    name: { singular: 'document' },
  },
  coi: {
    name: { singular: 'coi' },
    data: {
      holder: { name: 'a test coi holder' },
    },
  },
  audit: {
    name: { singular: 'fsqa-audit' },
    data: {
      organization: {
        location: {
          name: 'a test facility',
        },
      },
    },
  },
  cert: {
    name: { singular: 'fsqa-certificate' },
    data: {
      organization: {
        location: {
          name: 'a test facility',
        },
      },
    },
  },
  log: {
    name: { singular: 'letter-of-guarantee', plural: 'letters-of-guarantee' },
    data: {
      buyer: { name: 'a test log buyer' },
    },
  },
  //-------------------------------------
  // Master Data:
  tp: {
    name: { singular: 'trading-partner' },
    data: {
      masterid: 'test-master-tp-1', // triggers an expand-index and masterid-index
      name: 'a test trading partner',
      "fsqa-emails": _emails,
      "notifications-config": _emailsConfig,
      user: {
        id: 'users/TEST-TRELLISNOTIFICATIONS-TPUSER',
        bookmarks: { _id: 'resources/TEST-TRELLISNOTIFICATIONS-TPUSERBOOKMARKS' },
      },
    },
  },
  fac: {
    name: { singular: 'facility', plural: 'facilities' },
    data: {
      masterid: 'test-master-fac-1', // triggers an expand-index and masterid-index
      name: 'a test facility',
    },
  },
  coiholder: {
    name: { singular: 'coi-holder' },
    data: {
      masterid: 'test-master-coiholder-1', // triggers an expand-index and masterid-index
      name: 'a test coi holder',
    },
  },
  logbuyer: {
    name: {
      singular: 'letter-of-guarantee-buyer',
    },
    data: {
      masterid: 'test-master-logbuyer-1', // triggers an expand-index and masterid-index
      name: 'a test logbuyer',
    },
  },
};

// Fill out all missing things with defaults:
_.each(items, (i, k) => {
  console.log("--> k", k);
  i.key = `TEST-TRELLISNOTIFICATIONS-${k.toUpperCase()}`;          // default key
  if (!i.name.plural) i.name.plural = i.name.singular + 's';       // default plural
  if (!i.source) i.source = 'trellisfw';                           // default source
  if (!i.list) i.list = `/bookmarks/${i.source}/${i.name.plural}`; // default list
  if (!i.data) i.data = { iam: k };                                // default data
  if (!i._type) i._type = `application/vnd.${i.source}.${i.name.singular}.1+json`;
  if (!i.list_type) i.list_type = `application/vnd.${i.source}.${i.name.plural}.1+json`;
  // Also, fill out the tree for this list:
  if (!jp.get(tree, i.list)) {
    jp.set(tree, i.list, { _type: i.list_type });
  }
  // Add the '*' entry to the list in the tree:
  let path = `${i.list}/*`;
  if (!jp.get(tree, path)) {
    jp.set(tree, path, { _type: i._type });
  }
  if (i.data.masterid) {
    // This is masterdata, add the expand-index and masterid-index to the tree
    path = `${i.list}/expand-index`;
    if (!jp.get(tree, path)) {
      jp.set(tree, path, { _type: i.list_type });
    }
    path = `${i.list}/masterid-index`;
    if (!jp.get(tree, path)) {
      jp.set(tree, path, { _type: i.list_type });
    }
  }
});

// And finally, any inter-item relationships between master data:
items.tp.data.facilities = { [items.fac.key]: { _id: `resources/${items.fac.key}` }, };
items.coiholder.data['trading-partners'] = { [items.tp.key]: { _id: `resources/${items.tp.key}` } };
items.logbuyer.data['trading-partners'] = { [items.tp.key]: { _id: `resources/${items.tp.key}` } };

async function cleanup(key_or_keys) {
  let keys = _.keys(items);
  if (_.isArray(key_or_keys)) keys = key_or_keys;
  else if (key_or_keys) keys = [key_or_keys];
  info('cleanup: removing any lingering test resources');

  await Promise.each(keys, async (k) => {
    trace('cleanup: removing resources+links if they exist for key ', k);
    const i = items[k];
    let path;
    // Delete the link path from the list:
    path = `${i.list}/${i.key}`;
    await con.get({ path }).then(() => con.delete({ path })).catch(e => { });
    // Delete the actual resource for this thing too:
    path = `/resources/${i.key}`;
    await con.get({ path }).then(() => con.delete({ path })).catch(e => { });
    if (i.data.masterid) {
      // This is master data, so remove from masterid-index and expand-index
      path = `${i.list}/expand-index/${i.key}`;
      await con.get({ path }).then(() => con.delete({ path })).catch(e => { });
      path = `${i.list}/masterid-index/${i.data.masterid}`;
      await con.get({ path }).then(() => con.delete({ path })).catch(e => { });
    }
    // If there are extra lists to cleanup (like for jobs-success), do those too:
    if (i.cleanup && i.cleanup.lists) {
      await Promise.each(i.cleanup.lists, async l => {
        path = `${l}/${i.key}`;
        await con.get({ path }).then(() => con.delete({ path })).catch(e => { });
      });
    }
  });
}

/**
 * Cleaning up AbalonEmailJobs
 */
async function cleanupAbalonEmailJobs() {
  let _abalonemailPath = "/bookmarks/services/abalonemail/jobs/";
  let _abalonEmailJobs = await con
    .get({ path: _abalonemailPath })
    .then(r => r.data).catch(e => { });
  let keys = _.keys(_abalonEmailJobs);
  info('--> AbalonEmail Jobs cleanup: removing test resources', _abalonEmailJobs);

  await Promise.each(keys, async (k) => {
    trace('--> AbalonEmail Jobs cleanup: removing resources+links for key ', k);
    let _path;
    // Delete the jobs from the queue
    if (k.substring(0, 1) !== "_") {
      _path = `${_abalonemailPath}/${k}`;
      trace('--> AbalonEmail Jobs cleanup: removing link for path ', _path);
      await con.get({ path: _path }).then(() => con.delete({ path: _path })).catch(e => { });
      // Delete the actual resource
      _path = `/resources/${k}`;
      await con.get({ path: _path }).then(() => con.delete({ path: _path })).catch(e => { });
    }//if
  });
} //end cleanupAbalonEmailJobs

/**
 * Cleaning up trellis-notifications daily-digest queue
 */
async function cleanupTrellinsNotificationsDailyDigestQueue() {
  let _end = moment().format('YYYY-MM-DD');
  let _begin = moment("2020-08-24");

  for (let m = moment(_begin); m.diff(_end, 'days') <= 0; m.add(1, 'days')) {
    let _date = m.format("YYYY-MM-DD");
    let _tnPath = `/bookmarks/services/${_target}/notifications/day-index/${_date}`;
    trace('--> trellis-notifications daily-digest cleanup: removing link for path ', _tnPath);
    await con.get({ path: _tnPath }).then(() => con.delete({ path: _tnPath })).catch(e => { });
  }//for

} //end cleanupTrellinsNotificationsDailyDigestQueue

/**
 * 
 * @param key_or_keys 
 * @param merges 
 */
async function putData(key_or_keys, merges) {
  let keys = _.keys(items);
  let data_merges = [];
  if (_.isArray(key_or_keys)) {
    keys = key_or_keys;
    data_merges = merges || [];
  } else if (key_or_keys) {
    keys = [key_or_keys];
    data_merges = [merges];
  }

  await Promise.each(keys, async (k, ki) => {
    trace('putData: adding test data for key: ', k);
    const i = items[k];
    let path, data;

    // Make the resource:
    path = `/resources/${i.key}`;
    // Merge in any data overrides:
    data = i.data;
    if (data_merges[ki]) data = _.merge(data, data_merges[ki]);
    // Do the put:
    trace('putData: path: ', path, ', data = ', data);
    await con.put({ path, data, _type: i._type })
      .catch(e => {
        error('Failed to make the resource. path = ', path, ', data = ',
          i.data, ', _type = ', i._type, ', error = ', e); throw e
      });
    // If this has a user, go ahead and make their dummy bookmarks 
    // resource (i.e. a trading-partner)
    if (i.data.user && i.data.user.bookmarks) {
      await con.put({
        path: `/${i.data.user.bookmarks._id}`,
        _type: tree.bookmarks,
        data: { 'iam': 'userbookmarks' }
      }).catch(e => {
        error('Failed to make bookmarks for i.data.user. path = /',
          i.data.user.bookmarks._id, ', error = ', e); throw e
      });
    }
  });
}

/**
 * 
 * @param key_or_keys 
 */
async function putLink(key_or_keys) {
  let keys = _.keys(items);
  if (_.isArray(key_or_keys)) keys = key_or_keys;
  else if (key_or_keys) keys = [key_or_keys];

  await Promise.each(keys, async k => {
    const i = items[k];
    trace('putLink: linking test data for key: ', k, ', under list ', i.list);
    let path;

    // Link under the list:
    path = `${i.list}`;
    // NOTE: since we are doing a tree put, do NOT put the i.key on the end of the URL
    // because tree put will create a new resource instead of linking the existing one.
    let data = { [i.key]: { _id: `resources/${i.key}` } };
    if (!i.notversioned) data._rev = 0;
    await con.put({ path, data, tree })
      .catch(e => {
        error('Failed to link the resource. path = ', path, ', data = ',
          data, ', error = ', e); throw e
      });

    if (i.data.masterid) {
      // This is master data, so put it into the expand-index and masterid-index
      const data = _.cloneDeep(i.data);
      data.id = `resources/${i.key}`;
      // Put the expand-index:
      path = `${i.list}/expand-index`;
      await con.put({ path, data: { [i.key]: data }, tree })
        .catch(e => { error('Failed to put the expand-index.  e = ', e); throw e });

      // Put the masterid-index:
      path = `${i.list}/masterid-index`;
      await con.put({ path, data: { [i.data.masterid]: data }, tree })
        .catch(e => { error('Failed to put the masterid-index.  e = ', e); throw e });
    }
  });
}

/**
 * 
 * @param key_or_keys 
 * @param merges 
 */
async function putAndLinkData(key_or_keys, merges) {
  await putData(key_or_keys, merges);
  await putLink(key_or_keys);
}

chai.use(chaiAsPromised);
const expect = chai.expect;

const domain = 'proxy';
const token = 'god-proxy';

const REALISTIC_TIMING = true;

const doctypes = [DocType.AUDIT, DocType.CERT, DocType.COI, DocType.LOG];

process.env.NODE_TLS_REJECT_UNAUTHORIZED = 0;
describe('success job', () => {

  before(async function () {
    this.timeout(20000);
    con = await oada.connect({ domain, token });

    trace('before: cleanup');
    await cleanup();

    trace('before: cleanup abalon email jobs');
    await cleanupAbalonEmailJobs();

    trace('before: cleanup tellis-notifications daily digest');
    await cleanupTrellinsNotificationsDailyDigestQueue();

    trace('before: putData');
    // Build the tree with all the initial data:
    await putAndLinkData(['tp', 'fac', 'logbuyer', 'coiholder']);
    await putData(['pdf']); // don't link into job tree since 
    // that would trigger trellis-notifications 
    // to make a job for it

    // All 4 kinds of jobs: coi, audit, cert, log
    //--------------------------------------------------------
    await Promise.each(doctypes, async doctype => {
      trace('before: create job for doctype: ', doctype);
      const jobtype = doctype + 'job'; // coijob, auditjob, etc...
      const j = items[jobtype];
      // Example of a successful normal job: go ahead and put that up, 
      // tests will check results later
      await putAndLinkData(jobtype, {
        service: `${_target}`,
        type: `${doctype}-changed`,
        config: {
          notificationType: 'email',
          doctype: doctype,
          chroot: `trading-partners/TEST-TRELLISNOTIFICATIONS-TP`,
          userEndpoint: `user/bookmarks/trellisfw`,
          emailsEndpoint: `fsqa-emails`,
          user: {
            id: "USERID"
          }
        }
      });


      if (REALISTIC_TIMING) await Promise.delay(50);

      // Create the JSON resource
      const i = items[doctype];
      await putData(doctype);

      // Add the identified "lookup" to it's meta:
      let meta;
      switch (doctype) {
        case DocType.AUDIT:
          meta = { organization: { _ref: `resources/${items.fac.key}` } };
          break;
        case DocType.CERT:
          meta = { organization: { _ref: `resources/${items.fac.key}` } };
          break;
        case DocType.COI:
          meta = { holder: { _ref: `resources/${items.coiholder.key}` } };
          break;
        case DocType.LOG:
          meta = { buyer: { _ref: `resources/${items.logbuyer.key}` } };
          break;
      }
      await con.put({ path: `/resources/${i.key}/_meta/lookups/${i.name.singular}`, data: meta });

      // Link the final resource into the main list for this doctype:
      await putLink(doctype);

      // Put back result to the job
      await con.put({
        path: `${j.list}/${j.key}/result`, data: {
          [i.name.plural]: { [i.key]: { _id: `resources/${i.key}` } }
        }
      });

    });

    // Wait a bit for processing all the jobs
    if (REALISTIC_TIMING) await Promise.delay(2000);
  });


  _.each(doctypes, doctype => {
    describe('#' + doctype, () => {
      const jobtype = doctype + 'job';
      const i = items[doctype];
      const j = items[jobtype];
      const _tn_jobs = "/bookmarks/services/trellis-notifications/";
      const _job_success = "jobs-success/day-index/" + moment().format('YYYY-MM-DD') +
        "/TEST-TRELLISNOTIFICATIONS-";
      const _tp_tn_path = "/bookmarks/trellisfw/trading-partners/TEST-TRELLISNOTIFICATIONS-TP";


      it("should have set emails in the users tree", async () => {
        const result = await con.get({ path: _tp_tn_path }).then(r => r.data);
        expect(result).to.have.property("fsqa-emails");
      });

      it("should have exactly three emails in the object", async () => {
        const result = await con.get({ path: _tp_tn_path }).then(r => r.data);

        expect(result["fsqa-emails"]).to.be.an("string");
        let _to = emailParser.parseAddressList(result["fsqa-emails"]).map(({ name, address }) =>
          ({
            name: name || undefined,
            email: address
          }));
        expect(_to).to.have.length(3);
      });

      const _jobKeys = ["doctype", "chroot", "userEndpoint", "emailsEndpoint",
        "notificationType", "user"];
      let _tn_path = "";
      let _itMessage = "should include a ";

      switch (doctype) {
        case DocType.CERT:
          _itMessage += " CERTJOB";
          _tn_path = _tn_jobs + _job_success + "CERTJOB";
          break;

        case DocType.AUDIT:
          _itMessage += " AUDITJOB";
          _tn_path = _tn_jobs + _job_success + "AUDITJOB";
          break;

        case DocType.COI:
          _itMessage += " COIJOB";
          _tn_path = _tn_jobs + _job_success + "COIJOB";
          break;

        case DocType.LOG:
          _itMessage += " LOGJOB";
          _tn_path = _tn_jobs + _job_success + "LOGJOB";
          break;

        default:
          throw new Error("Document type not recognized");
      }

      it(`${_itMessage}`, async () => {
        const result = await con.get({ path: _tn_path }).then(r => r.data);
        expect(result).to.have.property("type");
        expect(result).to.have.property("config");
        expect(result.config).to.be.an("object");
        expect(result.config).to.have.all.keys(_jobKeys);
      });

    });
  });
});

