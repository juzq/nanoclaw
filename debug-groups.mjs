#!/usr/bin/env node

import fs from 'fs';
import path from 'path';

// Import NanoClaw functions
import { DATA_DIR } from './dist/config.js';

function debugGroups() {
  console.log('🔍 Debugging NanoClaw groups...');

  // Check IPC messages
  const ipcBaseDir = path.join(DATA_DIR, 'ipc');
  const mainGroupDir = path.join(ipcBaseDir, 'main');
  const messagesDir = path.join(mainGroupDir, 'messages');

  console.log(`\n📁 Checking IPC directory: ${messagesDir}`);
  if (fs.existsSync(messagesDir)) {
    const files = fs.readdirSync(messagesDir);
    console.log(`Found ${files.length} IPC message files:`);
    files.forEach(file => console.log(`  - ${file}`));
  } else {
    console.log('❌ IPC messages directory does not exist');
  }

  // Check groups directory
  const groupsDir = path.join(DATA_DIR, '..', 'groups');
  console.log(`\n📁 Checking groups directory: ${groupsDir}`);
  if (fs.existsSync(groupsDir)) {
    const groups = fs.readdirSync(groupsDir);
    console.log(`Found ${groups.length} groups:`);
    groups.forEach(group => {
      const groupPath = path.join(groupsDir, group);
      const stats = fs.statSync(groupPath);
      if (stats.isDirectory()) {
        console.log(`  - ${group} (directory)`);
      }
    });
  } else {
    console.log('❌ Groups directory does not exist');
  }

  // Check data sessions
  const sessionsDir = path.join(DATA_DIR, 'sessions');
  console.log(`\n📁 Checking sessions directory: ${sessionsDir}`);
  if (fs.existsSync(sessionsDir)) {
    const sessions = fs.readdirSync(sessionsDir);
    console.log(`Found ${sessions.length} session directories:`);
    sessions.forEach(session => {
      console.log(`  - ${session}`);
    });
  } else {
    console.log('❌ Sessions directory does not exist');
  }

  // Check database for registered groups
  const dbPath = path.join(DATA_DIR, 'nanoclaw.db');
  console.log(`\n🗄️  Database file: ${dbPath}`);
  if (fs.existsSync(dbPath)) {
    console.log('✅ Database exists');
    // Try to read some basic info about the database
    try {
      const sqlite3 = require('sqlite3');
      const db = new sqlite3.Database(dbPath);
      db.all("SELECT name FROM sqlite_master WHERE type='table'", (err, tables) => {
        if (!err && tables) {
          console.log('Tables in database:');
          tables.forEach(table => {
            console.log(`  - ${table.name}`);
          });
        }
        db.close();
      });
    } catch (e) {
      console.log('Could not connect to database:', e.message);
    }
  } else {
    console.log('❌ Database file does not exist');
  }
}

debugGroups();