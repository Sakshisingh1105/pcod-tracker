// Simple initializer for MySQL database schema (run manually)
const mysql = require('mysql2/promise');

async function run() {
  const host = process.env.MYSQL_HOST || 'localhost';
  const user = process.env.MYSQL_USER || 'root';
  const password = process.env.MYSQL_PASSWORD || '';
  const database = process.env.MYSQL_DATABASE || 'pcod_db';

  const conn = await mysql.createConnection({ host, user, password });
  await conn.query(`CREATE DATABASE IF NOT EXISTS \`${database}\``);
  await conn.changeUser({ database });

  const stmts = [
    `CREATE TABLE IF NOT EXISTS users (id INT AUTO_INCREMENT PRIMARY KEY, name VARCHAR(255), email VARCHAR(255) UNIQUE, password VARCHAR(255))`,
    `CREATE TABLE IF NOT EXISTS periods (id INT AUTO_INCREMENT PRIMARY KEY, user_id INT, start_date DATE, end_date DATE, notes TEXT)` ,
    `CREATE TABLE IF NOT EXISTS symptoms (id INT AUTO_INCREMENT PRIMARY KEY, user_id INT, date DATE, symptom_type VARCHAR(255), severity INT, notes TEXT)`,
    `CREATE TABLE IF NOT EXISTS diet_logs (id INT AUTO_INCREMENT PRIMARY KEY, user_id INT, date DATE, category VARCHAR(255), description TEXT, calories INT)`,
    `CREATE TABLE IF NOT EXISTS workout_logs (id INT AUTO_INCREMENT PRIMARY KEY, user_id INT, date DATE, workout_type VARCHAR(255), duration_minutes INT, notes TEXT)`,
    `CREATE TABLE IF NOT EXISTS shares (id INT AUTO_INCREMENT PRIMARY KEY, owner_user_id INT, partner_email VARCHAR(255), accepted TINYINT DEFAULT 0, token VARCHAR(255))`,
    `CREATE TABLE IF NOT EXISTS reminders (id INT AUTO_INCREMENT PRIMARY KEY, user_id INT, type VARCHAR(255), message TEXT, cron_expr VARCHAR(255), last_sent_at DATETIME, active TINYINT DEFAULT 1)`
  ];

  for (const s of stmts) {
    await conn.query(s);
  }
  console.log('MySQL schema ensured in database', database);
  await conn.end();
}

run().catch(e => { console.error(e); process.exit(1); });
