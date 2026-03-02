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

// Utility: Calculate next period based on last period and cycle length
function predictNextPeriod(lastPeriodStart, cycleLength) {
  if (!lastPeriodStart || !cycleLength) return null;
  const date = new Date(lastPeriodStart);
  date.setDate(date.getDate() + cycleLength);
  return date.toISOString().split('T')[0];
}

// Register
app.post('/api/register', async (req, res) => {
  try {
    const { name, email, password, age, height, weight, cycle_length } = req.body;
    if (!name || !email || !password) return res.status(400).json({ error: 'Missing fields' });
    db.get('SELECT id FROM users WHERE email = ?', [email], async (err, row) => {
      if (err) {
        console.error('DB error checking email:', err);
        return res.status(500).json({ error: 'Server error: ' + err.message });
      }
      if (row) return res.status(400).json({ error: 'Email already registered' });
      try {
        const hash = await bcrypt.hash(password, 10);
        db.run('INSERT INTO users (name,email,password,age,height,weight,cycle_length) VALUES (?,?,?,?,?,?,?)', 
          [name, email, hash, age || null, height || null, weight || null, cycle_length || null], function(err2){
          if (err2) {
            console.error('DB error inserting user:', err2);
            return res.status(500).json({ error: 'Server error: ' + err2.message });
          }
          const token = jwt.sign({ id: this.lastID }, JWT_SECRET, { expiresIn: '7d' });
          res.json({ token, userId: this.lastID });
        });
      } catch (hashErr) {
        console.error('Hash error:', hashErr);
        res.status(500).json({ error: 'Server error: ' + hashErr.message });
      }
    });
  } catch (err) {
    console.error('Register error:', err);
    res.status(500).json({ error: 'Server error: ' + err.message });
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
    const { partner_email, partner_name, relation } = req.body;
    if (!partner_email) return res.status(400).json({ error: 'partner_email required' });
    const token = crypto.randomBytes(16).toString('hex');
    db.run('INSERT INTO shares (owner_user_id, partner_email, partner_name, relation, token, permissions) VALUES (?,?,?,?,?,?)', 
      [req.userId, partner_email, partner_name || 'Partner', relation || 'family', token, 'read'], function(err){
      if (err) return res.status(500).json({ error: 'Server error' });
      // send email if transporter configured
      if (process.env.SMTP_USER) {
        const link = `${process.env.APP_URL || 'http://localhost:4000'}/share/accept?token=${token}`;
        transporter.sendMail({ from: process.env.SMTP_FROM || 'noreply@example.com', to: partner_email, subject: 'PCOD Care - Dashboard share invite', text: `You were invited to view a health dashboard. Accept: ${link}` }).catch(()=>{});
      }
      res.json({ token });
    });
  } catch (err) { console.error(err); res.status(500).json({ error: 'Server error' }); }
});

// Get shares for user
app.get('/api/share', auth, (req, res) => {
  try {
    db.all('SELECT id, partner_email, partner_name, relation, accepted, created_at FROM shares WHERE owner_user_id = ? ORDER BY created_at DESC', [req.userId], (err, rows) => {
      if (err) return res.status(500).json({ error: 'Server error' });
      res.json(rows || []);
    });
  } catch (err) { console.error(err); res.status(500).json({ error: 'Server error' }); }
});

// Delete share
app.delete('/api/share/:id', auth, (req, res) => {
  try {
    db.run('DELETE FROM shares WHERE id = ? AND owner_user_id = ?', [req.params.id, req.userId], function(err){
      if (err) return res.status(500).json({ error: 'Server error' });
      res.json({ ok: true });
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

// User Profile Endpoints
app.get('/api/profile', auth, (req, res) => {
  try {
    db.get('SELECT id, name, email, age, height, weight, cycle_length, last_period_start, role, language FROM users WHERE id = ?', [req.userId], (err, user) => {
      if (err) return res.status(500).json({ error: 'Server error' });
      if (!user) return res.status(404).json({ error: 'User not found' });
      res.json(user);
    });
  } catch (err) { console.error(err); res.status(500).json({ error: 'Server error' }); }
});

app.put('/api/profile', auth, (req, res) => {
  try {
    const { name, age, height, weight, cycle_length, last_period_start, language } = req.body;
    db.run(`UPDATE users SET name=?, age=?, height=?, weight=?, cycle_length=?, last_period_start=?, language=? WHERE id=?`, 
      [name || null, age || null, height || null, weight || null, cycle_length || null, last_period_start || null, language || 'en', req.userId], function(err){
      if (err) return res.status(500).json({ error: 'Server error' });
      res.json({ ok: true });
    });
  } catch (err) { console.error(err); res.status(500).json({ error: 'Server error' }); }
});

// Food Suggestions Endpoints
app.get('/api/food-suggestions', (req, res) => {
  try {
    const recommended = req.query.recommended ? parseInt(req.query.recommended) : null;
    let query = 'SELECT id, name, category, calories, benefits, is_recommended, avoid_reason FROM food_suggestions';
    if (recommended !== null) query += ` WHERE is_recommended = ${recommended}`;
    db.all(query, (err, rows) => {
      if (err) return res.status(500).json({ error: 'Server error' });
      res.json(rows || []);
    });
  } catch (err) { console.error(err); res.status(500).json({ error: 'Server error' }); }
});

// Workout Suggestions Endpoints
app.get('/api/workout-suggestions', (req, res) => {
  try {
    db.all('SELECT id, name, type, duration_minutes, intensity, benefits, description FROM workout_suggestions', [], (err, rows) => {
      if (err) return res.status(500).json({ error: 'Server error' });
      res.json(rows || []);
    });
  } catch (err) { console.error(err); res.status(500).json({ error: 'Server error' }); }
});

// Symptom Types Endpoints
app.get('/api/symptom-types', (req, res) => {
  try {
    db.all('SELECT id, name, category, description FROM symptom_types', [], (err, rows) => {
      if (err) return res.status(500).json({ error: 'Server error' });
      res.json(rows || []);
    });
  } catch (err) { console.error(err); res.status(500).json({ error: 'Server error' }); }
});

// Period Prediction Endpoint
app.get('/api/period/prediction', auth, (req, res) => {
  try {
    db.get('SELECT cycle_length, last_period_start FROM users WHERE id = ?', [req.userId], (err, user) => {
      if (err) return res.status(500).json({ error: 'Server error' });
      if (!user || !user.last_period_start || !user.cycle_length) {
        return res.json({ predicted_next_period: null, message: 'Complete profile with cycle length and last period date' });
      }
      const predicted = predictNextPeriod(user.last_period_start, user.cycle_length);
      res.json({ predicted_next_period: predicted, cycle_length: user.cycle_length });
    });
  } catch (err) { console.error(err); res.status(500).json({ error: 'Server error' }); }
});

// Enhanced Analytics Endpoint
app.get('/api/analytics', auth, (req, res) => {
  try {
    const analytics = {};
    db.all('SELECT COUNT(*) AS cnt FROM periods WHERE user_id = ?', [req.userId], (err, rows) => {
      analytics.total_periods = rows && rows[0] ? rows[0].cnt : 0;
      
      db.all('SELECT symptom_type, COUNT(*) AS cnt, AVG(severity) AS avg_severity FROM symptoms WHERE user_id = ? GROUP BY symptom_type ORDER BY cnt DESC', [req.userId], (err2, srows) => {
        analytics.symptom_freq = srows || [];
        
        db.all('SELECT category, COUNT(*) AS cnt, AVG(calories) AS avg_cal FROM diet_logs WHERE user_id = ? GROUP BY category ORDER BY cnt DESC', [req.userId], (err3, drows) => {
          analytics.diet_categories = drows || [];
          
          db.all('SELECT workout_type, COUNT(*) AS cnt, SUM(duration_minutes) AS total_duration FROM workout_logs WHERE user_id = ? GROUP BY workout_type ORDER BY cnt DESC', [req.userId], (err4, wrows) => {
            analytics.workout_types = wrows || [];
            
            // Average daily stats
            db.all(`SELECT 
              STRFTIME('%Y-%m-%d', date) as day,
              (SELECT AVG(severity) FROM symptoms WHERE user_id = ? AND STRFTIME('%Y-%m-%d', date) = day) as avg_symptom_severity,
              (SELECT SUM(duration_minutes) FROM workout_logs WHERE user_id = ? AND STRFTIME('%Y-%m-%d', date) = day) as total_workout_mins,
              (SELECT SUM(calories) FROM diet_logs WHERE user_id = ? AND STRFTIME('%Y-%m-%d', date) = day) as total_calories
            FROM (
              SELECT DISTINCT STRFTIME('%Y-%m-%d', date) as date FROM symptoms WHERE user_id = ?
              UNION
              SELECT DISTINCT STRFTIME('%Y-%m-%d', date) FROM workout_logs WHERE user_id = ?
              UNION
              SELECT DISTINCT STRFTIME('%Y-%m-%d', date) FROM diet_logs WHERE user_id = ?
            ) ORDER BY day DESC LIMIT 30`, 
            [req.userId, req.userId, req.userId, req.userId, req.userId, req.userId], (err5, daily) => {
              analytics.daily_stats = daily || [];
              
              db.get('SELECT cycle_length, last_period_start FROM users WHERE id = ?', [req.userId], (err6, user) => {
                if (user) {
                  analytics.cycle_length = user.cycle_length;
                  analytics.predicted_next_period = predictNextPeriod(user.last_period_start, user.cycle_length);
                }
                res.json(analytics);
              });
            });
          });
        });
      });
    });
  } catch (err) { console.error(err); res.status(500).json({ error: 'Server error' }); }
});

// Health Report Data Endpoint
app.get('/api/health-report', auth, (req, res) => {
  try {
    const report = {};
    db.get('SELECT name, age, height, weight, cycle_length FROM users WHERE id = ?', [req.userId], (err, user) => {
      if (user) report.user = user;
      
      db.all('SELECT * FROM periods WHERE user_id = ? ORDER BY start_date DESC LIMIT 12', [req.userId], (err2, periods) => {
        report.periods = periods || [];
        
        db.all('SELECT date, symptom_type, severity, notes FROM symptoms WHERE user_id = ? ORDER BY date DESC LIMIT 100', [req.userId], (err3, symptoms) => {
          report.symptoms = symptoms || [];
          
          db.all('SELECT date, category, description, calories FROM diet_logs WHERE user_id = ? ORDER BY date DESC LIMIT 100', [req.userId], (err4, diet) => {
            report.diet = diet || [];
            
            db.all('SELECT date, workout_type, duration_minutes, intensity, notes FROM workout_logs WHERE user_id = ? ORDER BY date DESC LIMIT 100', [req.userId], (err5, workouts) => {
              report.workouts = workouts || [];
              res.json(report);
            });
          });
        });
      });
    });
  } catch (err) { console.error(err); res.status(500).json({ error: 'Server error' }); }
});

// Delete reminder
app.delete('/api/reminders/:id', auth, (req, res) => {
  try {
    db.run('DELETE FROM reminders WHERE id = ? AND user_id = ?', [req.params.id, req.userId], function(err){
      if (err) return res.status(500).json({ error: 'Server error' });
      res.json({ ok: true });
    });
  } catch (err) { console.error(err); res.status(500).json({ error: 'Server error' }); }
});

// Update reminder
app.put('/api/reminders/:id', auth, (req, res) => {
  try {
    const { message, frequency, active } = req.body;
    db.run('UPDATE reminders SET message=?, frequency=?, active=? WHERE id = ? AND user_id = ?', 
      [message || null, frequency || null, active !== undefined ? active : 1, req.params.id, req.userId], function(err){
      if (err) return res.status(500).json({ error: 'Server error' });
      res.json({ ok: true });
    });
  } catch (err) { console.error(err); res.status(500).json({ error: 'Server error' }); }
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
