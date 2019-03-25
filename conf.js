/*jslint node: true */
"use strict";

/**
 *	for version control
 */
exports.clientName		= 'trustnote-pow-supernode';
exports.minClientVersion	= '1.1.0';


exports.WS_PROTOCOL = 'ws://';
// https://console.developers.google.com
exports.pushApiProjectNumber = 0;
exports.pushApiKey = '';

exports.port = 9193;
exports.myUrl = 'ws://10.10.11.50:9193';
exports.bServeAsHub = true;
exports.bSaveJointJson = true;
exports.bLight = false;
exports.bServeAsRpc = true;
exports.rpcInterface = '127.0.0.1';
exports.rpcPort = 6553;
exports.debug = false;

// byzantine
exports.IF_BYZANTINE = true;

// this is used by wallet vendor only, to redirect bug reports to developers' email
exports.bug_sink_email = 'admin@example.org';
exports.bugs_from_email = 'bugs@example.org';

exports.HEARTBEAT_TIMEOUT = 300*1000;

exports.initial_peers = [
    "ws://119.28.44.246:9193",
];

exports.storage = 'sqlite';

exports.deviceName = 'Supernode';
exports.permanent_pairing_secret = 'randomstring';

// change the address to your own
exports.safe_address = null;
exports.safe_device_address = null;
exports.coinbase_address = null;

exports.bSingleAddress = true;
exports.THRESHOLD_DISTANCE = 6;
exports.MIN_AVAILABLE_WITNESSINGS = 100;
exports.bPostTimestamp = false;

exports.start_mining_round = 0;
exports.maxWorkderCount = 0;

exports.KEYS_FILENAME = 'keys.json';

console.log('finished witness conf');
