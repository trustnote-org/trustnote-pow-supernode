/*jslint node: true */
"use strict";

var constants = require('trustnote-pow-common/config/constants.js');


var objectHash = require('trustnote-pow-common/base/object_hash.js');

var safeAddress = 'JNA6YWLKFQG7PFF6F32KTXBUAHRAFSET';
const arrDefinition = [
	'or', 
	[
		['address', constants.FOUNDATION_SAFE_ADDRESS],
		['address', safeAddress],
	]
];
const depositAddress = objectHash.getChash160(arrDefinition);


console.log(depositAddress);
