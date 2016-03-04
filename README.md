
# S4PP Gateway

*Simple Sensor Sample Streaming Push Protocol gateway*

## CI

TODO


## Deployment

To deploy the S4PP gateway:

On your local machine (ideally from CI) build the NPM package:

    npm pack

Then copy it to the target instance and install. *s4pp* run on the same
ec2 instance as the API:

    scp s4pp-gateway-1.0.0.tgz ec2-user@api-prod.intelligent.li
    ssh ec2-user@api-prod.intelligent.li
    sudo npm install -g s4pp-gateway-1.0.0.tgz

Create / configure the start up script:

```
cat >/etc/init/s4pp.conf <<EOL
description "s4pp gateway"
author      "ili"

start on filesystem or runlevel [2345]
stop on shutdown

script
    export ILI_API_HOST="0.0.0.0"
    export ILI_USER_SECRET_KEY="xxx"
    export ILI_USER_KEY="yyy"

    exec s4ppgw >> /var/log/s4pp.log 2>&1

end script

pre-start script
    echo "[`date`] s4ppgw starting" >> /var/log/s4pp.log
end script

pre-stop script
    echo "[`date`] s4ppgw stopping" >> /var/log/s4pp.log
end script
EOL
```

To Stop or Start the s4pp service use `upstart`

    sudo [stop/start] s4pp

To view S4PP logs

    tail /var/log/s4pp.log

The s4pp gateway requires API access to intelligent.li in order to
retrieve the sensors (users) that use the gateway service.  The intelligent.li
endpoint and access keys are exposed as environment variables in the upstart
config. Replace as neccessary.
