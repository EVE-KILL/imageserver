(async () => {
	// Fetch checksum from upstream
	let checksumUrl = 'https://newedenencyclopedia.net/dev_resource/icon_checksum.txt';
	let checksumRequest = await fetch(checksumUrl);
	let checksum = await checksumRequest.text();

	// Check if local checksum exists; if not, use an empty string
	let localFile = Bun.file('./images/checksum.txt');
	let localChecksum = await localFile.exists() ? await localFile.text() : '';

	if (checksum !== localChecksum) {
		console.log('Checksums differ, downloading new image dump...');
		// Download the archive as the checksums differ
		let archiveUrl = 'https://newedenencyclopedia.net/dev_resource/icons_dedup.zip';
		let archiveRequest = await fetch(archiveUrl);
		let archive = await archiveRequest.arrayBuffer();
		let archiveFile = new Blob([archive], { type: 'application/zip' });
		let archivePath = './images/icons_dedup.zip';
		await Bun.write(archivePath, archiveFile);

		// Extract the archive into the ./images directory
		let unzip = Bun.spawn(['unzip', '-o', archivePath, '-d', './images']);
		await unzip.exited;

		// Update the local checksum after the download
		await Bun.write('./images/checksum.txt', checksum);
	} else {
		console.log('Checksums match, no update needed.');
	}
})();
