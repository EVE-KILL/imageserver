(async () => {
	let archiveUrl = 'https://data.everef.net/ccp/portraits/OldCharPortraits_256.zip';
	let archivePath = './cache/oldcharacters/OldCharPortraits_256.zip';
	let extractDir = './cache/oldcharacters';

	// Create the directory if it doesn't exist
	let mkdir = Bun.spawn(['mkdir', '-p', extractDir]);
	await mkdir.exited;

	// Check if the archive already exists locally
	let localFile = Bun.file(archivePath);
	if (await localFile.exists()) {
		console.log('Archive already exists, skipping download.');
	} else {
		console.log('Downloading old character portraits...');
		let archiveRequest = await fetch(archiveUrl);
		let archive = await archiveRequest.arrayBuffer();
		let archiveFile = new Blob([archive], { type: 'application/zip' });
		await Bun.write(archivePath, archiveFile);
		console.log('Download complete.');
	}

	// Extract the archive
	console.log('Extracting archive...');
	let unzip = Bun.spawn(['unzip', '-o', archivePath, '-d', extractDir]);
	await unzip.exited;
	console.log('Extraction complete.');
})();
