# trellis-notifications

A microservice for notifications based on document type. A job notifies the event to a `destination`.

## Installation

```docker-compose
cd path/to/your/oada-srvc-docker
cd services-available
git clone git@github.com:trellisfw/trellis-notifications.git
cd ../services-enabled
ln -s ../services-available/trellis-notifications .
oada up -d trellis-notifications
```

