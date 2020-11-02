import Promise from "bluebird";
import { v4 as uuidv4 } from "uuid";
import emailParser from "email-addresses";
import moment from "moment";

export const Frequency = {
  DAILYFEED: "daily-feed",
  LIVEFEED: "live-feed"
};

export const DocType = {
  AUDIT: "audit",
  COI: "coi",
  CERT: "cert",
  LOG: "log",
  ALL: "all"
};

export const NotificationType = {
  EMAIL: "email"
};

export const doctypes = [DocType.AUDIT, DocType.CERT, DocType.COI, DocType.LOG];

/**
 * Generates a token
 */
export function generateToken() {
  return uuidv4().replace(/-/g, '');
}//end generateToken

export const DAILY = '00 59 23 * * *';
export const HOURLY = '00 00 * * * *';
export const FIVEMIN = "00 */5 * * * *";
export const DAILY_6PM = '00 00 18 * * *';

const TN = "trellis-notifications";

export default {
  test() {
    console.log("--> testing trellis notifications helper");
  },
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
    let _path = `/bookmarks/services/${TN}/notifications/day-index/${_date}/daily-digest-queue`;
    return _path;
  },//end getDailyDigestPath
  /**
  * get Daily Digest Queue
  * @param oada 
  */
  async getDailyDigestQueue(oada) {
    let _path = getDailyDigestPath();

    return oada
      .get({ path: _path })
      .then(r => r.data)
      .catch(e => {
        throw new Error("Failed to get daily digest queue, error " + e);
      });
  }//end getDailyDigestQueue

}//export
