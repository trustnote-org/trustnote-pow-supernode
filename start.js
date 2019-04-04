/*jslint node: true */
"use strict";
var Mnemonic = require('bitcore-mnemonic');

var constants = require('trustnote-pow-common/config/constants.js');
var conf = require('trustnote-pow-common/config/conf.js');
var desktopApp = require('trustnote-pow-common/base/desktop_app.js');
var db = require('trustnote-pow-common/db/db.js');
var eventBus = require('trustnote-pow-common/base/event_bus.js');
var round = require('trustnote-pow-common/pow/round.js');
var pow = require('trustnote-pow-common/pow/pow.js');
var deposit = require('trustnote-pow-common/sc/deposit');
var supernode = require('trustnote-pow-common/wallet/supernode');
var byzantine = require('trustnote-pow-common/mc/byzantine');
var _ = require('lodash');

require('./lib/relay.js');
require('./lib/push.js');
var logging = require('./lib/logging.js');

if (!conf.bSingleAddress)
	throw Error('witness must be single address');

var my_address;
var last_round_index = 0;
var last_main_chain_index = 0;
var wallet_id;
var xPrivKey;
var bMining = false; // if miner is mining
var bPowSent = false; // if pow joint is sent

function onError(err){
	// throw Error(err);
	console.log("Error: " + err);
}

function onMiningError(err){
	// throw Error(err);
	bMining = false;
	console.log("Mining Error: " + JSON.stringify(err));
}

function checkTrustMEAndStartMining(round_index){
	var network = require('trustnote-pow-common/p2p/network.js');
	if(!network.getIfMyurlClaimed()){
		return console.log(`My url is not claimed, will not mining`)
	}
	if(round_index < last_round_index) {
		return console.log(`Last Round Index is ${ last_round_index }, will not mining`)
	}
	if(bMining || bPowSent) {
		return console.log(`Checking if I can Mining ${ bMining } ${ bPowSent } ${ round_index }`)
	}
	// if(my_address == constants.FOUNDATION_ADDRESS) {
	// 	return console.log('Foundation will not mine');
	// }
	if(conf.start_mining_round > round_index) {
		return console.log("Current round is to early, will not be mining")
	}
	console.log(`Mining is on going : ${ bMining } Round : ${ round_index }`)
	bMining = true;
	db.takeConnectionFromPool(function(conn){
		conn.query("SELECT witnessed_level FROM units WHERE round_index=? AND is_stable=1 AND is_on_main_chain=1 AND pow_type=? LIMIT 1",
		[round_index, constants.POW_TYPE_TRUSTME], function(rows){
			if(rows.length>=1){
				pow.obtainMiningInput(conn, round_index, function(err, input_object) {
					conn.release();
					if (err) {
						// notifyAdminAboutWitnessingProblem(err)
						return onMiningError(err);
					}
					else {
						logging.infoStartMining(input_object);
						pow.startMiningWithInputs(input_object, function(err){
							if (err) {
								return onMiningError(err);
							} else {
								console.log("Mining is on going ");
							}
						})
					}
				})
			}
			else {
				bMining = false;
				conn.release();
			}
		})
	})
}

function determineIfIAmWitness(conn, round_index, handleResult){
	round.getWitnessesByRoundIndex(conn, round_index, function(arrWitnesses){
		conn.query(
			"SELECT 1 FROM my_addresses where address IN(?)", [arrWitnesses], function(rows) {
				if(rows.length===0) {
					return handleResult(false)
				}
				return handleResult(true)
			}
		)
	})
}

function checkRoundAndComposeCoinbase(round_index) {
	if(round_index===1) {
		return;
	}
	if(round_index < last_round_index) {
		return console.log(`Last Round Index is ${ last_round_index }, will not mining`)
	}

	var network = require('trustnote-pow-common/p2p/network.js');
	var composer = require('trustnote-pow-common/unit/composer.js');

	const callbacks = composer.getSavingCallbacks({
		ifNotEnoughFunds: onError,
		ifError: onError,
		ifOk: function(objJoint){
			network.broadcastJoint(objJoint);
			if(objJoint.unit.messages[0].payload.outputs[0].amount)
			{
				var coinbaseReward = 0;
				for (var j=0; j<objJoint.unit.messages[0].payload.outputs.length; j++){
					var output = objJoint.unit.messages[0].payload.outputs[j];
					if(output.address === my_address)
						coinbaseReward = parseInt(output.amount);
				}
				logging.infoCoinbaseReward(objJoint.unit.round_index, my_address, coinbaseReward);
			}
			else
				logging.infoCoinbaseReward(objJoint.unit.round_index, my_address, 0);
			console.log('=== Coinbase sent ===')
		}
	})
	
	console.log('Going to compose Coinbase')
	db.takeConnectionFromPool(function(conn){
		determineIfIAmWitness(conn, round_index-1, function(bWitness){
			if(bWitness) {
				conn.query("SELECT witnessed_level FROM units WHERE round_index=? AND is_stable=1 AND is_on_main_chain=1 AND pow_type=? LIMIT 1",
				[round_index, constants.POW_TYPE_TRUSTME], function(rows){
					if(rows.length >= 1) {
						conn.query("select 1 from units join unit_authors using(unit) where address=? and pow_type=? and round_index=?",
						[my_address, constants.POW_TYPE_COIN_BASE, round_index], function(rows){
							if(rows.length<=0){
								round.getCoinbaseByRoundIndexAndAddress(conn, round_index-1, my_address, function(coinbase_amount){
									conn.release();
									if(coinbase_amount===0){
										return console.log("No coinbase earned")
									}
									if(conf.coinbase_address){
										composer.composeCoinbaseJoint(my_address, conf.coinbase_address, round_index, coinbase_amount, supernode.signer, callbacks);
									} else {
										composer.composeCoinbaseJoint(my_address, my_address, round_index, coinbase_amount, supernode.signer, callbacks);
									}
								})
							} else {
								conn.release();
							}
						})
					} else {
						conn.release();
					}
				})
			} else {
				conn.release();
			}
		});
	})
}

setTimeout(function(){
	supernode.readKeys(function(mnemonic_phrase, passphrase){
		var mnemonic = new Mnemonic(mnemonic_phrase);
		// global
		xPrivKey = mnemonic.toHDPrivateKey(passphrase);
		var devicePrivKey = xPrivKey.derive("m/1'").privateKey.bn.toBuffer({size:32});
		// read the id of the only wallet
		supernode.readSingleWallet(db, function(wallet){
			// global
			wallet_id = wallet;
			var device = require('trustnote-pow-common/wallet/device.js');
			device.setDevicePrivateKey(devicePrivKey);
			let my_device_address = device.getMyDeviceAddress();
			db.query("SELECT 1 FROM extended_pubkeys WHERE device_address=?", [my_device_address], function(rows){
				if (rows.length > 1)
					throw Error("more than 1 extended_pubkey?");
				if (rows.length === 0)
					return setTimeout(function(){
						console.log('passphrase is incorrect');
						process.exit(0);
					}, 1000);
				require('trustnote-pow-common/wallet/supernode.js'); // we don't need any of its functions but it listens for hub/* messages
				if( !conf.safe_address ) {
					console.log('## We recommend you to set a safe address for your coin\'s safty where your coinbase rewards will be sent to.\nOther wise, the rewards will be sent to your supernode address');
				}
				eventBus.emit('headless_wallet_ready');
				setTimeout(logging.replaceConsoleLog, 1000);
				setTimeout(logging.replaceConsoleInfo, 1000);
				
			});
		});
	});
}, 1000);

// The below events can arrive only after we read the keys and connect to the hub.
// The event handlers depend on the global var wallet_id being set, which is set after reading the keys

eventBus.on('headless_wallet_ready', function(){
	var network = require('trustnote-pow-common/p2p/network.js');
	var composer = require('trustnote-pow-common/unit/composer.js');
	var supernode = require('trustnote-pow-common/wallet/supernode');
	
	if (conf.permanent_pairing_secret)
		db.query(
			"INSERT "+db.getIgnore()+" INTO pairing_secrets (pairing_secret, is_permanent, expiry_date) VALUES (?, 1, '2038-01-01')",
			[conf.permanent_pairing_secret]
		);
		
	// if (!conf.admin_email || !conf.from_email){
	// 	console.log("please specify admin_email and from_email in your "+desktopApp.getAppDataDir()+'/conf.json');
	// 	process.exit(1);
	// }

	supernode.readSingleAddress(db, function(address){
		my_address = address;
		// checkAndWitness();
		// eventBus.on('new_joint', checkAndWitness); // new_joint event is not sent while we are catching up
	});
	
	eventBus.on('round_switch', function(round_index){
		bMining = false;
		bPowSent = false;
		pow.stopMining(round_index-1)
		console.log('=== Round Switch === : '+round_index);
	});


	/**
	 *	POW MOD
	 *	
	 *	@datetime	2018/10/11 2:39 PM	
	 *	start using version control
	 *
	 *
	 * 	[REMOTE SIDE]
	 * 		- data in variable oBody comes from remote client
	 * 	oBody.program		= { package.json }.name
	 *	oBody.program_version	= { package.json }.version
	 *
	 *
	 * 	[LOCAL SIDE]
	 * 		- data in variable conf stores in local from been loaded on boot
	 *	conf.clientName		= { conf.js }.clientName
	 *	conf.minClientVersion	= { conf.js }.minClientVersion
	 * 	conf.program		= { package.json }.name		//	loaded on boot
	 *	conf.program_version	= { package.json }.version	//	loaded on boot
	 *
	 */
	eventBus.on( 'peer_version', function( oWs, oBody )
	{
		var version = require('./lib/version.js')
		if ( oBody.program === conf.clientName )
		{
			//
			//	user specified conf.minClientVersion
			//
			if ( conf.minClientVersion &&
				version.compareVersions( oBody.program_version, conf.minClientVersion ) === '<' )
			{
				//
				//	just tell remote the conf.minClientVersion
				//
				network.sendJustsaying( oWs, 'new_version', { version : conf.minClientVersion } );
			}

			if ( version.compareVersions( oBody.program_version, conf.program_version ) === '<' )
			{
				//
				//	close the connection while the remote is out of date
				//	so, the remote will be forced to update
				//
				console.log(`*************\n***** Client: ${oWs.host} version is too low, will cancel the connection.\n*************`)
				oWs.close( 1000, "mandatory upgrade" );
			}
		}
		var library = require('trustnote-pow-common/package.json');
		if (version.compareVersions(oBody.library_version, library.version) === '>' ) {
			console.log(`*************\n***** Library: My Library version is too low.\n*************`)
		} else if (version.compareVersions(oBody.library_version, library.version) === '<' ) {
			console.log(`*************\n***** Library: ${oWs.host} library version is too low, will cancel the connection.\n*************`)
			oWs.close( 1000, "mandatory upgrade" );
		}
		last_round_index = oBody.last_round_index;
	});

	eventBus.on('updated_last_round_index_from_peers', function (nLastRoundIndexFromPeers, nLastMainChainIndexFromPeers){
		last_round_index = nLastRoundIndexFromPeers;
		last_main_chain_index = nLastMainChainIndexFromPeers;
	})

	setInterval(function(){
		console.log(`Mining Status: ${bMining}, POW Status: ${bPowSent}  ready to checkTrustMEAndStartMinig`)
		round.getCurrentRoundIndex(null, function(round_index){
			checkRoundAndComposeCoinbase(round_index);
			checkTrustMEAndStartMining(round_index);
		})
	},20*1000);

	eventBus.on("launch_pow", function(round_index) {
		checkTrustMEAndStartMining(round_index)
	})
	
	eventBus.on("pow_mined_gift", function(err, solution){
		
		if(err) {
			return onMiningError(err);
		}

		// if(my_address == constants.FOUNDATION_ADDRESS) {
		// 	bMining = false;
		// 	return console.log('Foundation will not mine');
		// }

		console.log('===Will compose POW joint===');
	
		const callbacks = composer.getSavingCallbacks({
			ifNotEnoughFunds: onMiningError,
			ifError: onMiningError,
			ifOk: function(objJoint){
				bMining = false;
				bPowSent = true;
				network.broadcastJoint(objJoint);
				logging.infoMiningSuccess(JSON.stringify(objJoint.unit.round_index));
				console.log('===Pow=== objJoin sent')
			}
		})
	
		db.takeConnectionFromPool(function(conn){
			round.getCurrentRoundIndex(conn, function(round_index){
				if(round_index < last_round_index) {
					conn.release();
					return console.log(`Last Round Index is ${ last_round_index }, will not mining`)
				}
				if(round_index != solution.round){
					conn.release();
					return console.log("Round switched won't compose pow with wrong round index")
				}
				round.checkIfPowUnitByRoundIndexAndAddressExists(conn, round_index, my_address, function(bExist) {
					if(bExist) {
						conn.release()
						bMining = false;
						bPowSent = true;
						return console.log('POW already sent');
					}
					conn.query("SELECT count(*) as count from units where pow_type=? and round_index=?", [constants.POW_TYPE_POW_EQUHASH, round_index], function(rows){
						console.log(`Mining POW :${rows[0].count}`)
						if(rows[0].count >= constants.COUNT_POW_WITNESSES) {
							bMining = false;
							bPowSent = true;
							conn.release()
							return console.log('There is already more than '+constants.COUNT_POW_WITNESSES+' pow joints, will not compose another one')
						}
						var address = conf.safe_address ? conf.safe_address : my_address
						deposit.getDepositAddressBySafeAddress(conn, address, function(err, deposit_address){
							conn.release()
							if(err) {
								return onMiningError(err)
							}
							composer.composePowJoint(my_address, round_index, solution.publicSeed, deposit_address, {hash:solution.hash, selfBits:solution.selfBits, nonce:solution.nonce}, supernode.signer, callbacks)
						})
					})
				});
			})
		});
	})

	eventBus.on("byzantine_success", function(address, proposal, approvedCoordinators){
		
		if(address !== my_address){
			return byzantine.doStartPhase(proposal.unit.hp, parseInt(proposal.phase)+1);
		}
		if(last_main_chain_index >= proposal.unit.hp){
			return byzantine.doStartPhase(proposal.unit.hp, parseInt(proposal.phase)+1);
		}

		function onTrustMeError(){
			return byzantine.doStartPhase(proposal.unit.hp, parseInt(proposal.phase)+1);
		}
		const callbacks = composer.getSavingCallbacks({
			ifNotEnoughFunds: onTrustMeError,
			ifError: onTrustMeError,
			ifOk: function(objJoint){
				network.broadcastJoint(objJoint);
			}
		});
		var objNakedProposal = _.cloneDeep(proposal);
		var objNakedApprovedCoordinators = _.cloneDeep(approvedCoordinators);
		composer.composeCoordinatorTrustMe(address, objNakedProposal, proposal.phase, objNakedApprovedCoordinators, supernode.signer, callbacks);      
	})

	if(conf.bServeAsRpc){
		var rpc_service = require('./lib/rpc_service.js');
		rpc_service.initRPC();
	}
});
