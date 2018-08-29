/*jslint node: true */
"use strict";

exports.clientName = 'TTT';
exports.minClientVersion = '1.1.0';
exports.WS_PROTOCOL = 'ws://';
// https://console.developers.google.com
exports.pushApiProjectNumber = 0;
exports.pushApiKey = '';

exports.port = 9191;
//exports.myUrl = 'ws://10.10.11.68:9191';
exports.bServeAsHub = true;
exports.bSaveJointJson = true;
exports.bLight = false;

// this is used by wallet vendor only, to redirect bug reports to developers' email
exports.bug_sink_email = 'admin@example.org';
exports.bugs_from_email = 'bugs@example.org';

exports.HEARTBEAT_TIMEOUT = 300*1000;

exports.initial_peers = [
    "ws://dev.mainchain.pow.trustnote.org:9191",
];

exports.storage = 'sqlite';

exports.deviceName = 'Supernode';
exports.permanent_pairing_secret = 'randomstring';
exports.control_addresses = ['DEVICE ALLOWED TO CHAT'];
exports.payout_address = 'WHERE THE MONEY CAN BE SENT TO';

exports.initialWitnesses = [
    "JNA6YWLKFQG7PFF6F32KTXBUAHRAFSET",
    "4T7YVRUWMVAJIBSWCP35C7OGCX33SAYO",
    "A4BRUVOW2LSLH6LVQ3TWFOCAM6JPFWOK",
    "BHYNQIMH6KGLVQALJ5AM6EM7RTDDGF3P",
    "D55F4JL2R3S4UHX4UXVFGOWTZPZR2YXO",
    "JKATXQDYSE5TGRRZG6QUJS2GVYLCAPHM",
    "TLLGQTKOT7ZINCOSBJG64LKE3ZTD3EDK",
    "UK7TAQI27IV63N7Q6UB7BSE6OP2B25Z2",
    "ZW35QKXIKK47A7HW3YRIV6TU3DYDTIVR"
];

exports.bSingleAddress = true;
exports.THRESHOLD_DISTANCE = 7;
exports.MIN_AVAILABLE_WITNESSINGS = 100;
exports.bPostTimestamp = false;

exports.KEYS_FILENAME = 'keys.json';

console.log('finished witness conf');
