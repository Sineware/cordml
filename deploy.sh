#!/usr/bin/env bash
USER=swadmin
HOST=192.168.11.89
DIR=/home/$USER/cordml/

rsync -avz --delete --exclude "node_modules" . ${USER}@${HOST}:${DIR}

exit 0