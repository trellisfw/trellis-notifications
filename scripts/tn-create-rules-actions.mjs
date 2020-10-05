import Promise from "bluebird";
import Jobs from "@oada/jobs";
import config from "../config.js";
const { Service } = Jobs;
const TOKEN = config.get('token');
let DOMAIN = config.get('domain') || '';
const TN = "trellis-notifications";

const service = new Service(TN, DOMAIN, TOKEN, 1, {
  finishReporters: []
}); // 1 concurrent job


let _rulesTree = {
  bookmarks: {
    _type: 'application/vnd.oada.bookmarks.1+json',
    _rev: 0,
    services: {
      '_type': 'application/vnd.oada.services.1+json',
      '_rev': 0,
      '*': {
        _type: 'application/vnd.oada.service.1+json',
        _rev: 0,
        rules: {
          _type: 'application/vnd.oada.rules.1+json',
          _rev: 0,
          actions: {
            '_type': 'application/vnd.oada.rules.actions.1+json',
            '_rev': 0,
            '*': {
              _type: 'application/vnd.oada.rules.action.1+json',
              _rev: 0,
            },
          },
          conditions: {
            '_type': 'application/vnd.oada.rules.conditions.1+json',
            '_rev': 0,
            '*': {
              _type: 'application/vnd.oada.rules.condition.1+json',
              _rev: 0,
            },
          },
          configured: {
            '_type': 'application/vnd.oada.rules.configured.1+json',
            '_rev': 0,
            '*': {
              _type: 'application/vnd.oada.rule.configured.1+json',
              _rev: 0,
            },
          },
          compiled: {
            '_type': 'application/vnd.oada.rules.compiled.1+json',
            '_rev': 0,
            '*': {
              _type: 'application/vnd.oada.rule.compiled.1+json',
              _rev: 0,
            },
          },
        },
      },
    },
  },
};

// creating actions structure
let _rulesData = {
  "notify-fsqa-emails-livefeed": {
    name: "notify-fsqa-emails-livefeed",
    service: "trellis-notifications",
    type: "application/json",
    description: "send notification to fsqa emails"
  },
  "notify-audit-emails-livefeed": {
    name: "notify-audit-emails-livefeed",
    service: "trellis-notifications",
    type: "application/json",
    description: "send notification to audit emails"
  },
  "notify-coi-emails-livefeed": {
    name: "notify-coi-emails-livefeed",
    service: "trellis-notifications",
    type: "application/json",
    description: "send notification to coi emails"
  },
  "notify-log-emails-livefeed": {
    name: "notify-log-emails-livefeed",
    service: "trellis-notifications",
    type: "application/json",
    description: "send notification to log emails"
  },
  "notify-fsqa-emails-dailyfeed": {
    name: "notify-fsqa-emails-dailyfeed",
    service: "trellis-notifications",
    type: "application/json",
    description: "send daily notification to fsqa emails"
  },
  "notify-audit-emails-dailyfeed": {
    name: "notify-audit-emails-dailyfeed",
    service: "trellis-notifications",
    type: "application/json",
    description: "send daily notification to audit emails"
  },
  "notify-coi-emails-dailyfeed": {
    name: "notify-coi-emails-dailyfeed",
    service: "trellis-notifications",
    type: "application/json",
    description: "send daily notification to coi emails"
  },
  "notify-log-emails-dailyfeed": {
    name: "notify-log-emails-dailyfeed",
    service: "trellis-notifications",
    type: "application/json",
    description: "send daily notification to log emails"
  }
};

let _rulesDataKeys = Object.keys(_rulesData);
const _conn = service.getClient(DOMAIN).clone(TOKEN);

Promise.each(_rulesDataKeys, async _key => {
  // Register action in OADA
  const { headers } = await _conn.put({
    path: `/bookmarks/services/trellis-notifications/rules/actions/${_rulesData[_key].name}`,
    tree: _rulesTree,
    data: _rulesData[_key],
  });
});