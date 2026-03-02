const express = require('express');
const bodyParser = require('body-parser');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcrypt');
const path = require('path');
const db = require('./db');
const nodemailer = require('nodemailer');
const cron = require('node-cron');
const PDFDocument = require('pdfkit');
const crypto = require('crypto');

// Email transporter (configure via env)
const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST || 'smtp.example.com',
  port: process.env.SMTP_PORT ? parseInt(process.env.SMTP_PORT) : 587,
  secure: false,
  auth: process.env.SMTP_USER ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS } : null
});

const app = express();
const PORT = process.env.PORT || 4000;
const JWT_SECRET = process.env.JWT_SECRET || 'change_this_secret';

app.use(bodyParser.json());

// Serve frontend static files
app.use('/', express.static(path.join(__dirname, 'frontend')));
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'frontend/app.html'));
});

// Register
app.post('/api/register', async (req, res) => {
  try {
    const { name, email, password } = req.body;
    if (!name || !email || !password) return res.status(400).json({ error: 'Missing fields' });
    db.get('SELECT id FROM users WHERE email = ?', [email], async (err, row) => {
      if (err) return res.status(500).json({ error: 'Server error' });
      if (row) return res.status(400).json({ error: 'Email already registered' });
      const hash = await bcrypt.hash(password, 10);
      db.run('INSERT INTO users (name,email,password) VALUES (?,?,?)', [name, email, hash], function(err2){
        if (err2) return res.status(500).json({ error: 'Server error' });
        const token = jwt.sign({ id: this.lastID }, JWT_SECRET, { expiresIn: '7d' });
        res.json({ token });
      });
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

// Login
app.post('/api/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) return res.status(400).json({ error: 'Missing fields' });
    db.get('SELECT id, password FROM users WHERE email = ?', [email], async (err, user) => {
      if (err) return res.status(500).json({ error: 'Server error' });
      if (!user) return res.status(400).json({ error: 'Invalid credentials' });
      const ok = await bcrypt.compare(password, user.password);
      if (!ok) return res.status(400).json({ error: 'Invalid credentials' });
      const token = jwt.sign({ id: user.id }, JWT_SECRET, { expiresIn: '7d' });
      res.json({ token });
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

// Middleware: authenticate
function auth(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader) return res.status(401).json({ error: 'No token' });
  const parts = authHeader.split(' ');
  if (parts.length !== 2) return res.status(401).json({ error: 'Bad token' });
  const token = parts[1];
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    req.userId = payload.id;
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Invalid token' });
  }
}

// Create period log
app.post('/api/periods', auth, (req, res) => {
  try {
    const { start_date, end_date, notes } = req.body;
    if (!start_date) return res.status(400).json({ error: 'start_date required' });
    db.run('INSERT INTO periods (user_id, start_date, end_date, notes) VALUES (?,?,?,?)', [req.userId, start_date, end_date || null, notes || null], function(err){
      if (err) return res.status(500).json({ error: 'Server error' });
      res.json({ id: this.lastID });
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

// Get periods for user
app.get('/api/periods', auth, (req, res) => {
  try {
    db.all('SELECT id, start_date, end_date, notes FROM periods WHERE user_id = ? ORDER BY start_date DESC', [req.userId], (err, rows) => {
      if (err) return res.status(500).json({ error: 'Server error' });
      res.json(rows);
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

// Create symptom log
app.post('/api/symptoms', auth, (req, res) => {
  try {
    const { date, symptom_type, severity, notes } = req.body;
    if (!symptom_type) return res.status(400).json({ error: 'symptom_type required' });
    const d = date || new Date().toISOString().slice(0,10);
    db.run('INSERT INTO symptoms (user_id, date, symptom_type, severity, notes) VALUES (?,?,?,?,?)', [req.userId, d, symptom_type, severity || null, notes || null], function(err){
      if (err) return res.status(500).json({ error: 'Server error' });
      res.json({ id: this.lastID });
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

// Get symptoms for user
app.get('/api/symptoms', auth, (req, res) => {
  try {
    db.all('SELECT id, date, symptom_type, severity, notes FROM symptoms WHERE user_id = ? ORDER BY date DESC', [req.userId], (err, rows) => {
      if (err) return res.status(500).json({ error: 'Server error' });
      res.json(rows);
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

// Diet log endpoints
app.post('/api/diet', auth, (req, res) => {
  try {
    const { date, category, description, calories } = req.body;
    const d = date || new Date().toISOString().slice(0,10);
    db.run('INSERT INTO diet_logs (user_id, date, category, description, calories) VALUES (?,?,?,?,?)', [req.userId, d, category || null, description || null, calories || null], function(err){
      if (err) return res.status(500).json({ error: 'Server error' });
      res.json({ id: this.lastID });
    });
  } catch (err) { console.error(err); res.status(500).json({ error: 'Server error' }); }
});

app.get('/api/diet', auth, (req, res) => {
  try {
    db.all('SELECT id, date, category, description, calories FROM diet_logs WHERE user_id = ? ORDER BY date DESC', [req.userId], (err, rows) => {
      if (err) return res.status(500).json({ error: 'Server error' });
      res.json(rows);
    });
  } catch (err) { console.error(err); res.status(500).json({ error: 'Server error' }); }
});

// Workout log endpoints
app.post('/api/workouts', auth, (req, res) => {
  try {
    const { date, workout_type, duration_minutes, notes } = req.body;
    const d = date || new Date().toISOString().slice(0,10);
    db.run('INSERT INTO workout_logs (user_id, date, workout_type, duration_minutes, notes) VALUES (?,?,?,?,?)', [req.userId, d, workout_type || null, duration_minutes || null, notes || null], function(err){
      if (err) return res.status(500).json({ error: 'Server error' });
      res.json({ id: this.lastID });
    });
  } catch (err) { console.error(err); res.status(500).json({ error: 'Server error' }); }
});

app.get('/api/workouts', auth, (req, res) => {
  try {
    db.all('SELECT id, date, workout_type, duration_minutes, notes FROM workout_logs WHERE user_id = ? ORDER BY date DESC', [req.userId], (err, rows) => {
      if (err) return res.status(500).json({ error: 'Server error' });
      res.json(rows);
    });
  } catch (err) { console.error(err); res.status(500).json({ error: 'Server error' }); }
});

// Share endpoint - invite partner
app.post('/api/share', auth, (req, res) => {
  try {
    const { partner_email } = req.body;
    if (!partner_email) return res.status(400).json({ error: 'partner_email required' });
    const token = crypto.randomBytes(16).toString('hex');
    db.run('INSERT INTO shares (owner_user_id, partner_email, token) VALUES (?,?,?)', [req.userId, partner_email, token], function(err){
      if (err) return res.status(500).json({ error: 'Server error' });
      // send email if transporter configured
      if (process.env.SMTP_USER) {
        const link = `${process.env.APP_URL || 'http://localhost:4000'}/share/accept?token=${token}`;
        transporter.sendMail({ from: process.env.SMTP_FROM || 'noreply@example.com', to: partner_email, subject: 'PCOD Care - Dashboard share invite', text: `You were invited to view a dashboard. Accept: ${link}` }).catch(()=>{});
      }
      res.json({ token });
    });
  } catch (err) { console.error(err); res.status(500).json({ error: 'Server error' }); }
});

// Accept share (public link)
app.get('/share/accept', (req, res) => {
  const { token } = req.query;
  if (!token) return res.status(400).send('Missing token');
  db.get('SELECT id, owner_user_id, partner_email FROM shares WHERE token = ?', [token], (err, row) => {
    if (err || !row) return res.status(400).send('Invalid token');
    db.run('UPDATE shares SET accepted = 1 WHERE id = ?', [row.id], function(err2){
      if (err2) return res.status(500).send('Server error');
      res.send('Share accepted — the owner will see it marked accepted.');
    });
  });
});

// Reminders endpoints
app.post('/api/reminders', auth, (req, res) => {
  try {
    const { type, message, cron_expr } = req.body;
    if (!cron_expr) return res.status(400).json({ error: 'cron_expr required' });
    db.run('INSERT INTO reminders (user_id, type, message, cron_expr) VALUES (?,?,?,?)', [req.userId, type || 'generic', message || '', cron_expr], function(err){
      if (err) return res.status(500).json({ error: 'Server error' });
      res.json({ id: this.lastID });
    });
  } catch (err) { console.error(err); res.status(500).json({ error: 'Server error' }); }
});

app.get('/api/reminders', auth, (req, res) => {
  try {
    db.all('SELECT id, type, message, cron_expr, last_sent_at, active FROM reminders WHERE user_id = ?', [req.userId], (err, rows) => {
      if (err) return res.status(500).json({ error: 'Server error' });
      res.json(rows);
    });
  } catch (err) { console.error(err); res.status(500).json({ error: 'Server error' }); }
});

// Cron runner: check reminders and send email if due
cron.schedule('* * * * *', () => {
  db.all('SELECT r.id, r.user_id, r.type, r.message, r.cron_expr, u.email FROM reminders r JOIN users u ON u.id = r.user_id WHERE r.active = 1', [], (err, rows) => {
    if (err || !rows) return;
    rows.forEach(rem => {
      try {
        if (!rem.cron_expr) return;
        // simple check using node-cron validation: schedule a task to run now if matches
        if (cron.validate(rem.cron_expr)){
          // send email
          if (process.env.SMTP_USER) {
            transporter.sendMail({ from: process.env.SMTP_FROM || 'noreply@example.com', to: rem.email, subject: `Reminder: ${rem.type}`, text: rem.message }).catch(()=>{});
          }
          db.run('UPDATE reminders SET last_sent_at = ? WHERE id = ?', [new Date().toISOString(), rem.id], ()=>{});
        }
      } catch (e) {}
    });
  });
});

// PDF export endpoint
app.get('/api/export/report', auth, (req, res) => {
  try {
    const doc = new PDFDocument();
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 'attachment; filename="pcod_report.pdf"');
    doc.pipe(res);
    doc.fontSize(18).text('PCOD Care — Health Report', { align: 'center' });
    doc.moveDown();
    db.all('SELECT start_date, end_date, notes FROM periods WHERE user_id = ? ORDER BY start_date DESC LIMIT 20', [req.userId], (err, periods) => {
      doc.fontSize(14).text('Recent Periods:');
      periods.forEach(p => { doc.fontSize(12).text(`${p.start_date} → ${p.end_date || ''} ${p.notes || ''}`); });
      db.all('SELECT date, symptom_type, severity, notes FROM symptoms WHERE user_id = ? ORDER BY date DESC LIMIT 50', [req.userId], (err2, syms) => {
        doc.moveDown();
        doc.fontSize(14).text('Recent Symptoms:');
        syms.forEach(s => { doc.fontSize(12).text(`${s.date} — ${s.symptom_type} (Severity: ${s.severity || 'n/a'}) ${s.notes || ''}`); });
        doc.end();
      });
    });
  } catch (err) { console.error(err); res.status(500).json({ error: 'Server error' }); }
});

// Simple analytics endpoint
app.get('/api/analytics', auth, (req, res) => {
  try {
    const analytics = {};
    db.all('SELECT COUNT(*) AS cnt FROM periods WHERE user_id = ?', [req.userId], (err, rows) => {
      analytics.periods = rows && rows[0] ? rows[0].cnt : 0;
      db.all('SELECT symptom_type, COUNT(*) AS cnt FROM symptoms WHERE user_id = ? GROUP BY symptom_type', [req.userId], (err2, srows) => {
        analytics.symptom_freq = srows || [];
        db.all('SELECT category, COUNT(*) AS cnt FROM diet_logs WHERE user_id = ? GROUP BY category', [req.userId], (err3, drows) => {
          analytics.diet_categories = drows || [];
          db.all('SELECT workout_type, COUNT(*) AS cnt FROM workout_logs WHERE user_id = ? GROUP BY workout_type', [req.userId], (err4, wrows) => {
            analytics.workout_types = wrows || [];
            res.json(analytics);
          });
        });
      });
    });
  } catch (err) { console.error(err); res.status(500).json({ error: 'Server error' }); }
});

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
