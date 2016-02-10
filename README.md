
# S4PP Gateway

*Simple Sensor Sample Streaming Push Protocol gateway*

## CI

TODO


## Deployment

To deploy the S4PP gateway:

On your local machine (ideally from CI) build the NPM package:

    npm pack

Then copy it to the target instance and install:

    scp s4pp-gateway-1.0.0.tgz admin@xx.xx.xx.xx:
    ssh admin@xx.xx.xx.xx
    sudo ln -s /usr/bin/nodejs /usr/bin/node
    sudo npm install -g s4pp-gateway-1.0.0.tgz

Create / configure the start up script if required:

    cat >/etc/systemd/system/s4pp.service <<EOL
    [Service]
    ExecStart=/usr/local/bin/s4ppgw /var/log/s4pp.data
    Restart=always
    StandardOutput=syslog
    StandardError=syslog
    SyslogIdentifier=s4pp
    User=s4pp
    Group=s4pp
    Environment=NODE_ENV=production
    Environment=ILI_API_HOST=api.xxx.intelligent.li
    Environment=ILI_USER_KEY=xxxxxx
    Environment=ILI_USER_SECRET_KEY=xxxxxx

    [Install]
    WantedBy=multi-user.target
    EOL

The s4pp gateway requires API access to intelligent.li in order to
retrieve the sensors (users) that use the gateway service.  The intelligent.li
endpoint and access keys are exposed as environment variables in the systemd
config
