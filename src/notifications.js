import Promise from "bluebird";
import { v4 as uuidv4 } from "uuid";
import emailParser from "email-addresses";
import moment from "moment";

export const RATE_LIMIT = 12;//twelve emails per minute

export const Frequency = {
  DAILY_FEED: "daily-feed",
  LIVE_FEED: "live-feed"
};

export const DocType = {
  AUDIT: "audit",
  COI: "coi",
  CERT: "cert",
  LOG: "log",
  ALL: "all"
};

export const NotificationType = {
  EMAIL: "email",
  SMS: "sms",
  TRELLIS: "trellis"
};

export const docTypes = [DocType.AUDIT, DocType.CERT, DocType.COI, DocType.LOG];

export const DAILY = '00 59 23 * * *';
export const HOURLY = '00 00 * * * *';
export const FIVE_MIN = "00 */5 * * * *";
export const DAILY_4PM = '00 00 16 * * *';
export const DAILY_6PM = '00 00 18 * * *';

const TN = "trellis-notifications";

export let notifications = {};
export let userConfig = {};
export let dailyNotifications = {};
export let dailyNotificationsQueue = [];

/** ============================================================================
 *  rules-engine configuration
 *  ============================================================================ 
*/
// Input parameters
export const rulesEngineOptions = {
  required: ["notificationType", "docType", "emailsToNotify"],
  properties: {
    notificationType: {
      description: "The notification type [email, text, etc.]",
      default: NotificationType.EMAIL,
      type: "string"
    },
    docType: {
      description: "The document type",
      default: DocType.AUDIT,
      type: "string"
    },
    emailsToNotify: {
      description: "The emails endpoint [retrieves array of emails]",
      default: "servio@qlever.io",
      type: "string"
    }
  }
};

export default {
  test() {
    console.log("--> testing trellis notifications helper");
  },
  /**
 * Generates a token
 */
  generateToken() {
    return uuidv4().replace(/-/g, '');
  },//end generateToken
  /**
 * Parses the emails to notify
 * @param _emails 
 */
  parseEmails(_emails) {
    return emailParser.parseAddressList(_emails).map(({ name, address }) =>
    ({
      name: name || undefined,
      email: address
    }));
  },//end parseEmails
  /**
 * Generates the subject to be sent by the notification service
 * @param docType -> type of document
 */
  getSubject(docType) {
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
      case DocType.ALL:
        _subject = "Daily digest - new documents available";
        break;
      default:
        throw new Error("Document type not recognized");
    }//switch

    return _subject;
  },//end getSubject

  /**
  * get Daily Digest Path
  */
  getDailyDigestPath() {
    let _date = moment().format('YYYY-MM-DD');
    let _path = `/bookmarks/services/${TN}/notifications/day-index/${_date}`;
    return _path;
  },//end getDailyDigestPath
  /**
  * get Daily Digest Queue
  * @param oada 
  */
  async getDailyDigest(oada) {
    let _path = getDailyDigestPath();

    return oada
      .get({ path: _path })
      .then(r => r.data);
    //.catch(e => {
    //  throw new Error("--> notifications module -> Failed to get daily digest queue, error " + e);
    //});
  },//end getDailyDigestQueue

  /**
 * Updating daily digest after processing daily digest
 * @param oada 
 * @param _content 
 */
  async updateDailyDigest(oada, _content) {
    let _path = getDailyDigestPath();

    return oada.put({
      path: _path,
      data: _content
    }).catch(e => {
      throw new Error("--> updateDailyDigest(): Failed to update daily digest " + e);
    });
  },//end updateDailyDigestQueue

  /**
   * updates daily digest as completed
   * @param {*} oada 
   */
  async markDailyDigestAsCompleted(oada) {
    let _content = { processed: true };
    return this.updateDailyDigest(oada, _content);
  },

  /**
   * creates the endpoint for the daily digest if not created
   * @param {*} oada 
   */
  async createDailyDigest(oada) {
    let _content = {
      processed: false,
      "daily-digest-queue": {}
    };
    return this.updateDailyDigest(oada, _content);
  },

  /**
   * gets user personalized configuration for notifications
   * @param {*} oada 
   */
  async getUserConfig(oada) {
    let _path = `/bookmarks/services/${TN}/notifications/user-config`;

    return oada
      .get({ path: _path })
      .then(r => r.data)
      .catch(e => {
        throw new Error("Failed to get daily digest queue, error " + e);
      });
  },
  /**
   * updates the personalized user configuration for notifications
   * @param {*} oada 
   * @param {*} _content 
   */
  async updateUserConfig(oada, _content) {
    let _path = `/bookmarks/services/${TN}/notifications/user-config`;

    _content = {
      "serviopalacios@gmail.com": {
        id: "serviopalacios@gmail.com",
        email: "serviopalacios@gmail.com",
        notificationType: NotificationType.EMAIL,
        frequency: Frequency.LIVE_FEED
      },
      "servio@qlever.io": {
        id: "servio@qlever.io",
        email: "servio@qlever.io",
        notificationType: NotificationType.EMAIL,
        frequency: Frequency.DAILY_FEED
      },
      "servio@palacios.com": {
        id: "servio@palacios.com",
        email: "servio@palacios.com",
        notificationType: NotificationType.EMAIL,
        frequency: Frequency.LIVE_FEED
      }
    };

    return oada.put({
      path: _path,
      data: _content
    }).catch(e => {
      throw new Error("--> updateUserConfig(): Failed to update user-config " + e);
    });
  },

  /**
 * Gets the LIVE_FEED Emails from notifications
 */
  getLiveFeedEmails(notifications) {
    let _entries = Object.entries(notifications);
    let _counter = 0;
    let _result = "";
    let _emails = "";

    for (const [email, notification] of _entries) {
      if (notification.config.frequency === Frequency.LIVE_FEED) {
        _result += email + ",";
        _counter++;
      }//if
    }//for

    if (_counter > 0) {
      _emails = _result.substring(0, _result.length - 1);
    }

    return _emails;
  },//end getLiveFeedEmails

  /**
 * Populates the values for all notifications in the config
 * @param _to 
 * @param _notificationsConfigData 
 */
  //TODO: need to update the global notifications object (ht)
  populateNotifications(_to, _notificationsConfigData, _docType) {
    let _emailsConfig = _notificationsConfigData["notifications-config"];
    let _configTemplate = {
      id: "",
      type: "email",
      frequency: "",
      docType: _docType
    };

    if (_to) {
      _to.forEach(function (item) {
        let _template = _.cloneDeep(_configTemplate);
        _template.id = item.email;
        if (_emailsConfig[item.email] && _emailsConfig[item.email].frequency) {
          _template.frequency = _emailsConfig[item.email].frequency;
        } else {
          _template.frequency = Frequency.LIVE_FEED;
        }
        notifications[item.email] = {};
        notifications[item.email].config = {};
        notifications[item.email].config = _template;
      });
    }
  },//end populateNotifications

  /**
 * notifyUser: notifies user according to endpoint
 * @param param0 
 */
  async notifyUser({ oada, _tnUserEndpoint, _emailsToNotify,
    _notificationsConfig, _emails, job, notifications }) {
    trace('--> notify User ', job.config.doctype);
    let _tradingPartnerId = job.config.chroot.replace(/^.*trading-partners\/([^\/]+)(\/.*)$/, '$1');
    const _docType = job.config.doctype;
    const _userToken = generateToken();
    const _auth = await getAuthorization(oada, job, _userToken);
    const _notificationsConfigData = await getNotificationConfigData(oada, _notificationsConfig);
    let _to = Notifications.parseEmails(_emails);
    populateNotifications(_to, _notificationsConfigData, _docType);
    let _list = await insertDailyDigestQueue(oada, notifications, _userToken);
    let _liveFeedEmails = getLiveFeedEmails();
    let _jobkey = await createEmailJob(oada, _docType, _liveFeedEmails, _emails, _userToken);

    let _config = {
      result: "success",
      destinationPath: _tnUserEndpoint,
      tnUserEndpoint: _tnUserEndpoint,
      emailsToNotify: _emailsToNotify,
      emails: _emails,
      liveFeeEmails: _liveFeedEmails,
      tradingPartnerId: _tradingPartnerId,
      jobkey: _jobkey,
      notifications: notifications,
      dailyDigest: _list
    };

    return _config;
  },//end notifyUser

  /**
 * Flushing daily notifications hash table after processing the queue
 */
  flushDailyNotifications() {
    dailyNotifications = {};
  }//end flushDailyNotifications()

}//export
