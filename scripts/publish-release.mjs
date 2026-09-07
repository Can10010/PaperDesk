import fs from 'node:fs';
import { createHash } from 'node:crypto';

const token = process.env.GH_TOKEN;
const repository = process.env.GITHUB_REPOSITORY || '';
const commit = process.env.RELEASE_COMMIT || '';
const version = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version;
const tag = 'v' + version;
const prefix = '/repos/' + repository;
const headers = {
  Authorization: 'Bearer ' + token,
  Accept: 'application/vnd.github+json',
  'User-Agent': 'PaperDesk-release',
  'X-GitHub-Api-Version': '2022-11-28',
};
const digest = bytes => 'sha256:' + createHash('sha256').update(bytes).digest('hex');

async function api(route, method = 'GET', body, allowMissing = false) {
  for (let attempt = 0; ; attempt++) {
    let response;
    try {
      response = await fetch('https://api.github.com' + route, {
        method, headers: { ...headers, 'Content-Type': 'application/json' },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        signal: AbortSignal.timeout(30000),
      });
    } catch (error) {
      if (method !== 'GET' || attempt >= 2) throw error;
      await new Promise(resolve => setTimeout(resolve, 1000));
      continue;
    }
    if (allowMissing && response.status === 404) return null;
    if (!response.ok) throw new Error('GitHub ' + method + ' ' + route + ': HTTP ' + response.status);
    if (response.status === 204) return null;
    return response.json();
  }
}

async function verifyTag() {
  const ref = await api(prefix + '/git/ref/tags/' + tag, 'GET', undefined, true);
  if (!ref) return;
  let object = ref.object;
  for (let depth = 0; object.type === 'tag'; depth++) {
    if (depth >= 8) throw new Error('Too many nested annotated tags.');
    object = (await api(prefix + '/git/tags/' + object.sha)).object;
  }
  if (object.type !== 'commit' || object.sha !== commit) {
    throw new Error('The version tag points to another commit. Bump the package version.');
  }
}

async function main() {
  if (!token || !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository) || !/^[0-9a-f]{40}$/.test(commit)) {
    throw new Error('Set GH_TOKEN, GITHUB_REPOSITORY and the full RELEASE_COMMIT SHA.');
  }
  if (!/^\d+\.\d+\.\d+$/.test(version)) throw new Error('Expected a stable package version.');
  const remotePackage = await api(prefix + '/contents/package.json?ref=' + commit);
  if (remotePackage.encoding !== 'base64' ||
      JSON.parse(Buffer.from(remotePackage.content, 'base64').toString('utf8')).version !== version) {
    throw new Error('Installer source version differs from the release version.');
  }
  await verifyTag();

  const directory = new URL('../release/', import.meta.url);
  const names = ['PaperDesk-' + version + '-x64.exe', 'PaperDesk-' + version + '-x64.zip'];
  const files = names.map(name => {
    const location = new URL(name, directory);
    const bytes = fs.readFileSync(location);
    if (bytes.subarray(0, 2).toString() !== (name.endsWith('.exe') ? 'MZ' : 'PK')) {
      throw new Error('Unexpected installer file: ' + name);
    }
    return { name, location, size: bytes.length, digest: digest(bytes) };
  });
  const checksumBytes = Buffer.from(files.map(file => file.digest.slice(7) + '  ' + file.name).join('\n') + '\n');
  const checksumPath = new URL('SHA256SUMS.txt', directory);
  fs.writeFileSync(checksumPath, checksumBytes);
  files.push({ name: 'SHA256SUMS.txt', location: checksumPath, size: checksumBytes.length, digest: digest(checksumBytes) });

  const releases = await api(prefix + '/releases?per_page=100');
  let release = releases.find(item => item.tag_name === tag);
  if (release && !release.draft) throw new Error('This release is already public. Published versions are never overwritten.');
  const metadata = {
    tag_name: tag,
    target_commitish: commit,
    name: release?.name || 'PaperDesk ' + version,
    body: release?.body || 'Windows x64。安装程序可自选目录；ZIP 解压后运行 PaperDesk.exe。使用说明见仓库 README。源码使用 MIT 许可证；安装包未进行代码签名。',
    draft: true,
    prerelease: false,
  };
  if (!release) release = await api(prefix + '/releases', 'POST', metadata);
  else release = await api(prefix + '/releases/' + release.id, 'PATCH', metadata);
  const route = prefix + '/releases/' + release.id;
  release = await api(route);
  if (!release.draft || release.tag_name !== tag) throw new Error('Draft version metadata was not preserved.');
  console.log('Uploading verified build ' + commit + ' to draft ' + release.id);

  const currentAssets = await api(route + '/assets?per_page=100');
  if (currentAssets.some(asset => !files.some(file => file.name === asset.name))) {
    throw new Error('Draft contains additional unreviewed attachments.');
  }
  for (const file of files) {
    const existing = currentAssets.find(asset => asset.name === file.name);
    if (existing?.state === 'uploaded' && existing.digest === file.digest && existing.size === file.size) continue;
    if (existing) await api(prefix + '/releases/assets/' + existing.id, 'DELETE');
    const uploadUrl = new URL(release.upload_url.replace(/\{.*\}$/, ''));
    if (uploadUrl.protocol !== 'https:' || uploadUrl.hostname !== 'uploads.github.com' ||
        uploadUrl.pathname !== prefix + '/releases/' + release.id + '/assets') {
      throw new Error('Unexpected GitHub upload address.');
    }
    uploadUrl.searchParams.set('name', file.name);
    console.log('Uploading ' + file.name);
    const response = await fetch(uploadUrl, {
      method: 'POST', headers: { ...headers, 'Content-Type': 'application/octet-stream', 'Content-Length': String(file.size) },
      body: fs.readFileSync(file.location), signal: AbortSignal.timeout(600000),
    });
    if (!response.ok) throw new Error('Upload failed for ' + file.name + ': HTTP ' + response.status);
    const asset = await response.json();
    if (asset.state !== 'uploaded' || asset.digest !== file.digest || asset.size !== file.size) {
      throw new Error('Upload checksum verification failed: ' + file.name);
    }
    console.log('Verified ' + file.name + ' ' + file.digest);
  }

  const assets = await api(route + '/assets?per_page=100');
  if (assets.length !== files.length || files.some(file => !assets.some(asset =>
      asset.name === file.name && asset.state === 'uploaded' && asset.size === file.size && asset.digest === file.digest))) {
    throw new Error('Release attachments failed final verification.');
  }
  await verifyTag();
  const published = await api(route, 'PATCH', { ...metadata, draft: false, make_latest: 'true' });
  if (published.draft || published.tag_name !== tag) throw new Error('Published release metadata is unexpected.');
  await verifyTag();
  console.log('Published ' + published.html_url);
}

main().catch(error => {
  console.error(error.message, error.cause?.code || '');
  process.exitCode = 1;
});
