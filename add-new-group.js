#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

// Import NanoClaw functions
const { DATA_DIR } = require('./dist/config.js');
const { isValidGroupFolder } = require('./dist/group-folder.js');

function createIpcMessage(data) {
  const ipcBaseDir = path.join(DATA_DIR, 'ipc');
  const mainGroupDir = path.join(ipcBaseDir, 'main');
  const messagesDir = path.join(mainGroupDir, 'messages');

  // Ensure directories exist
  fs.mkdirSync(messagesDir, { recursive: true });

  // Create the IPC message file
  const fileName = `register-group-${Date.now()}.json`;
  const filePath = path.join(messagesDir, fileName);

  fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
  console.log(`✅ Created registration request at: ${filePath}`);
  console.log(`
📝 To register a new group, you need to:

1. Get your Feishu group JID (chat ID)
2. Make sure the bot is added to the group
3. Run this script with the required parameters
4. Restart NanoClaw or wait for it to pick up the new group

Example usage:
node add-new-group.js --jid "feishu:newgroup123" --name "New Group" --folder "newgroup" --trigger "@Andy"

The script will create an IPC message that tells NanoClaw to register the new group.
  `);
}

// Parse command line arguments
const args = process.argv.slice(2);
if (args.length === 0 || args.includes('--help') || args.includes('-h')) {
  console.log(`
Usage: node add-new-group.js [options]

Options:
  --jid <jid>           The group JID (required) - e.g., "feishu:group123"
  --name <name>         The display name for the group (required)
  --folder <folder>     The folder name for the group (required)
  --trigger <trigger>   The trigger word (default: "@Andy")
  --requires-trigger    Whether the group requires trigger word (default: true)

Examples:
  node add-new-group.js --jid "feishu:mygroup123" --name "My Team" --folder "myteam"
  node add-new-group.js --jid "feishu:project-x" --name "Project X" --folder "projectx" --trigger "@Assistant"
  `);
  process.exit(0);
}

const argMap = new Map();
for (let i = 0; i < args.length; i += 2) {
  if (args[i].startsWith('--')) {
    const key = args[i].substring(2);
    const value = args[i + 1];
    if (value) {
      argMap.set(key, value);
    }
  }
}

const jid = argMap.get('jid');
const name = argMap.get('name');
const folder = argMap.get('folder');
const trigger = argMap.get('trigger') || '@Andy';

if (!jid || !name || !folder) {
  console.error('❌ Missing required parameters!');
  console.error('Required: --jid, --name, --folder');
  process.exit(1);
}

if (!isValidGroupFolder(folder)) {
  console.error(`❌ Invalid folder name: "${folder}"`);
  console.error('Folder names should only contain letters, numbers, hyphens, and underscores.');
  process.exit(1);
}

const data = {
  type: 'register_group',
  jid,
  name,
  folder,
  trigger,
  requiresTrigger: true
};

createIpcMessage(data);