#!/bin/bash
node server.mjs &
next start -p ${PORT:-80}