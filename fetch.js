#!/usr/bin/env node

import c from 'chalk';
import { ethers } from 'ethers';
import * as fs from 'fs';
import sqlite3 from 'sqlite3';
import { open } from 'sqlite';

const shortaddr = addr => `${addr.slice(0, 6)}..${addr.slice(-4)}`;

async function fetchCode(provider, address, name) {
	const path = `.${name}/${address}.bytecode`;
	const code = await provider.getCode(address);
	fs.writeFile(path, code, 'utf8', err => {
		if (err) console.error(`Error while writing ${c.yellow(path)}`, err);
	});
}

async function txs(provider, blockNumber, name, db) {
	const info = (address, txHash) => console.info(c.magenta(shortaddr(address)), txHash);

	process.stdout.write(`\uD83D\uDCE6 ${c.cyan(blockNumber)}`);
	const row = await db.get('SELECT txs FROM blocks WHERE number = ?', blockNumber);
	if (row) {
		console.info(` ${row.txs} txs`, c.dim('[cached]'));
		const contracts = await db.all('SELECT address, tx FROM contracts WHERE number = ?', blockNumber);
		contracts.forEach(({ address, txHash }) => info(address, c.dim(txHash)));
	} else {
		const block = await provider.getBlock(blockNumber);
		console.info(` ${block.transactions.length} txs`);

		await Promise.all(block.transactions
			.map(txHash => Promise
				.all([provider.getTransaction(txHash), provider.getTransactionReceipt(txHash)])
				.then(([tx, receipt]) => {
					if (!tx.to && receipt.contractAddress) {
						const address = receipt.contractAddress;
						info(address, txHash);
						void fetchCode(provider, address, name);
						void db.run('INSERT INTO contracts(number, address, tx) VALUES (:number, :address, :tx)', {
							':number': blockNumber,
							':address': address,
							':tx': txHash,
						});
					}
				})));

		await db.run('INSERT INTO blocks(number, txs) VALUES (:number, :txs)', {
			':number': blockNumber,
			':txs': block.transactions.length,
		});
		// for (const txHash of block.transactions) {
		// 	const [tx, receipt] = await Promise.all([provider.getTransaction(txHash), provider.getTransactionReceipt(txHash)]);
		// 	// const receipt = await provider.getTransactionReceipt(txHash);
		// 	if (!tx.to && receipt.contractAddress) {
		// 		const address = receipt.contractAddress;
		// 		info(address, txHash);
		// 		await fetchCode(provider, address, name);
		// 		await db.run('INSERT INTO contracts(number, address, tx) VALUES (:number, :address, :tx)', {
		// 			':number': blockNumber,
		// 			':address': address,
		// 			':tx': txHash,
		// 		});
		// 		contracts.push({ address, txHash });
		// 	}
		// }

		// fs.writeFile(path, JSON.stringify(contracts, null, 2), 'utf8', err => {
		// 	if (err) throw err;
		// });
	}
}

async function main() {
	const info = (message, ...optionalParams) => console.info(c.dim('[info]'), message, ...optionalParams);

	const url = 'http://127.0.0.1:8545';
	info('Connecting to', c.blue(url), '...');

	const provider = new ethers.JsonRpcProvider(url);
	const network = await provider.getNetwork();
	const latestBlock = await provider.getBlockNumber()

	info('Network', c.blue(network.name), `(${c.yellow(network.chainId)})`, 'at \uD83D\uDCE6 block', c.green(latestBlock));

	const dbname = `${network.name}.sqlite`;
	info('Opening db', c.blue(dbname));
	const db = await open({
		filename: dbname,
		driver: sqlite3.Database
	});
	await db.exec('CREATE TABLE IF NOT EXISTS blocks (number INTEGER PRIMARY KEY, txs INTEGER NOT NULL) STRICT');
	await db.exec('CREATE TABLE IF NOT EXISTS contracts (number INTEGER NOT NULL, address TEXT PRIMARY KEY, tx TEXT NOT NULL) STRICT');

	const row = await db.get('SELECT MAX(number) AS number FROM blocks');
	const startBlock = row.number ? row.number + 1 : 2_000_000;
	info('Starting from \uD83D\uDCE6 block', c.green(startBlock));

	for (let blockNumber = startBlock; blockNumber <= latestBlock; blockNumber++) {
		await txs(provider, blockNumber, network.name, db);
	}
}

main().catch(console.error);
