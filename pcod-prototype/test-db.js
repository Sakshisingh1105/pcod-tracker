const db = require('./db');

setTimeout(() => {
  db.all("SELECT name FROM sqlite_master WHERE type='table'", (err, rows) => {
    if (err) {
      console.error('Error:', err);
    } else {
      console.log('Tables created:');
      rows.forEach(r => console.log('  -', r.name));
    }
    process.exit();
  });
}, 500);
