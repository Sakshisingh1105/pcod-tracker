const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const DB_PATH = process.env.DB_PATH || path.join(__dirname, 'data.sqlite');
const db = new sqlite3.Database(DB_PATH);

db.serialize(() => {
  // Users table with profile info
  db.run(`CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    email TEXT UNIQUE NOT NULL,
    password TEXT NOT NULL,
    age INTEGER,
    height REAL,
    weight REAL,
    cycle_length INTEGER,
    last_period_start TEXT,
    role TEXT DEFAULT 'user',
    language TEXT DEFAULT 'en',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);

  // Period logs
  db.run(`CREATE TABLE IF NOT EXISTS periods (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    start_date TEXT NOT NULL,
    end_date TEXT,
    notes TEXT,
    flow_intensity TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(user_id) REFERENCES users(id)
  )`);

  // Symptoms with predefined types
  db.run(`CREATE TABLE IF NOT EXISTS symptoms (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    date TEXT NOT NULL,
    symptom_type TEXT NOT NULL,
    severity INTEGER,
    notes TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(user_id) REFERENCES users(id)
  )`);
  
  // Predefined symptom checklist
  db.run(`CREATE TABLE IF NOT EXISTS symptom_types (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT UNIQUE NOT NULL,
    category TEXT,
    description TEXT
  )`);
  
  // Diet logs
  db.run(`CREATE TABLE IF NOT EXISTS diet_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    date TEXT NOT NULL,
    meal_type TEXT,
    category TEXT,
    description TEXT,
    calories INTEGER,
    is_recommended INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(user_id) REFERENCES users(id)
  )`);

  // PCOD-friendly food suggestions
  db.run(`CREATE TABLE IF NOT EXISTS food_suggestions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    category TEXT NOT NULL,
    calories INTEGER,
    benefits TEXT,
    is_recommended INTEGER DEFAULT 1,
    avoid_reason TEXT
  )`);

  // Workout logs
  db.run(`CREATE TABLE IF NOT EXISTS workout_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    date TEXT NOT NULL,
    workout_type TEXT NOT NULL,
    duration_minutes INTEGER,
    intensity TEXT,
    calories_burned INTEGER,
    notes TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(user_id) REFERENCES users(id)
  )`);

  // Workout recommendations
  db.run(`CREATE TABLE IF NOT EXISTS workout_suggestions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    type TEXT NOT NULL,
    duration_minutes INTEGER,
    intensity TEXT,
    benefits TEXT,
    description TEXT
  )`);

  // Partner/Family access sharing
  db.run(`CREATE TABLE IF NOT EXISTS shares (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    owner_user_id INTEGER NOT NULL,
    partner_email TEXT NOT NULL,
    partner_name TEXT,
    relation TEXT,
    accepted INTEGER DEFAULT 0,
    token TEXT,
    permissions TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(owner_user_id) REFERENCES users(id)
  )`);
  
  // Smart reminders
  db.run(`CREATE TABLE IF NOT EXISTS reminders (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    type TEXT NOT NULL,
    message TEXT NOT NULL,
    trigger_time TEXT,
    frequency TEXT,
    next_trigger TEXT,
    last_sent_at TEXT,
    active INTEGER DEFAULT 1,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(user_id) REFERENCES users(id)
  )`);

  // Analytics snapshots for trend analysis
  db.run(`CREATE TABLE IF NOT EXISTS analytics_snapshots (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    date TEXT NOT NULL,
    avg_symptom_severity REAL,
    workout_count INTEGER,
    avg_calories INTEGER,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(user_id) REFERENCES users(id)
  )`);

  // Insert default symptom types
  const symptoms = [
    ['Acne', 'skin', 'Facial breakouts and skin irritation'],
    ['Hair Fall', 'hair', 'Excessive hair loss'],
    ['Mood Swings', 'mood', 'Emotional fluctuations'],
    ['Fatigue', 'energy', 'Unusual tiredness'],
    ['Cravings', 'appetite', 'Food cravings and hunger changes'],
    ['Weight Gain', 'body', 'Unexplained weight increase'],
    ['Irregular Period', 'cycle', 'Period timing variations'],
    ['Painful Periods', 'pain', 'Period-related pain'],
    ['Bloating', 'body', 'Abdominal bloating'],
    ['Hair Growth', 'hair', 'Unwanted hair growth (hirsutism)']
  ];
  
  symptoms.forEach(([name, category, desc]) => {
    db.run(`INSERT OR IGNORE INTO symptom_types (name, category, description) VALUES (?, ?, ?)`, [name, category, desc]);
  });

  // Insert PCOD-friendly foods
  const foods = [
    ['Whole Grains (Brown Rice, Oats)', 'recommended', 250, 'High fiber helps regulate blood sugar', 1, null],
    ['Leafy Greens (Spinach, Kale)', 'recommended', 25, 'Rich in iron and antioxidants', 1, null],
    ['Eggs', 'recommended', 78, 'High protein, supports hormonal balance', 1, null],
    ['Salmon', 'recommended', 208, 'Omega-3 helps reduce inflammation', 1, null],
    ['Almonds', 'recommended', 164, 'Good fats, helps with satiety', 1, null],
    ['Greek Yogurt', 'recommended', 59, 'High protein, low sugar', 1, null],
    ['Sweet Potato', 'recommended', 103, 'Complex carbs, nutrient dense', 1, null],
    ['Berries', 'recommended', 57, 'Antioxidants, low glycemic index', 1, null],
    ['White Bread', 'avoid', 265, 'High glycemic index causes blood sugar spikes', 0, 'Choose whole grain instead'],
    ['Sugary Drinks', 'avoid', 140, 'High sugar intake worsens insulin resistance', 0, 'Drink water or green tea'],
    ['Fried Foods', 'avoid', 320, 'Increases inflammation', 0, 'Grill or bake instead'],
    ['Processed Meats', 'avoid', 290, 'High sodium and preservatives', 0, 'Choose lean, fresh proteins']
  ];

  foods.forEach(([name, category, cal, benefits, recommended, avoid]) => {
    db.run(`INSERT OR IGNORE INTO food_suggestions (name, category, calories, benefits, is_recommended, avoid_reason) VALUES (?, ?, ?, ?, ?, ?)`, 
      [name, category, cal, benefits, recommended, avoid]);
  });

  // Insert workout suggestions
  const workouts = [
    ['Yoga', 'flexibility', 30, 'light', 'Improves flexibility, reduces stress, regulates hormones'],
    ['Walking', 'cardio', 30, 'light', 'Low-impact cardio, helps with weight management'],
    ['Swimming', 'cardio', 45, 'moderate', 'Full-body workout, easy on joints'],
    ['Strength Training', 'strength', 45, 'moderate', 'Build muscle, improve metabolism'],
    ['Pilates', 'flexibility', 45, 'moderate', 'Core strengthening, posture improvement'],
    ['Cycling', 'cardio', 45, 'moderate', 'Great for cardiovascular health'],
    ['Dancing', 'cardio', 30, 'moderate', 'Fun cardio, mood booster'],
    ['HIIT Training', 'cardio', 20, 'high', 'Effective for insulin resistance (consult doctor)']
  ];

  workouts.forEach(([name, type, duration, intensity, benefits]) => {
    db.run(`INSERT OR IGNORE INTO workout_suggestions (name, type, duration_minutes, intensity, benefits) VALUES (?, ?, ?, ?, ?)`, 
      [name, type, duration, intensity, benefits]);
  });
});

module.exports = db;
