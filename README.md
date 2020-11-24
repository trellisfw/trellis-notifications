# trellis-notifications

A microservice for notifications based on document type. A job notifies the event to a `destination`.

## Basics

The service accepts jobs with a configuration similar to the following:


```http
POST /bookmarks/services/trellis-notifications/jobs
{
 "service": "trellis-notifications",
    "type": "audit-changed",
    "config": {
        "notificationType": "email",
        "doctype": "audit",
        "chroot": "trading-partners/TEST-TRELLISNOTIFICATIONS-TP",
        "userEndpoint": "user/bookmarks/trellisfw",
        "emailsEndpoint": "fsqa-emails",
        "user": {
            "id": "USERID"
        }
    },
    "src": { "_id": "resources/123abc" }
}
```

### Installation

```docker-compose
cd path/to/your/oada-srvc-docker
cd services-available
git clone git@github.com:trellisfw/trellis-notifications.git
cd ../services-enabled
ln -s ../services-available/trellis-notifications .
oada up -d trellis-notifications
```

