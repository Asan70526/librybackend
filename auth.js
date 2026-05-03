const jwt = require("jsonwebtoken");
const fs = require("fs");
const path = require("path");

const USERS_DB = path.join(__dirname, "users.json");
const JWT_SECRET = "SUPER_SECRET_KEY_123"; // потом вынеси в .env

/* =========================
   HELPERS
========================= */
function readUsers() {
  if (!fs.existsSync(USERS_DB)) {
    fs.writeFileSync(
      USERS_DB,
      JSON.stringify(
        {
          users: [
            {
              id: 1,
              login: "admin",
              password: "admin123", // ⚠️ для учебного проекта
              role: "admin"
            }
          ]
        },
        null,
        2
      )
    );
  }
  return JSON.parse(fs.readFileSync(USERS_DB));
}

function writeUsers(data) {
  fs.writeFileSync(USERS_DB, JSON.stringify(data, null, 2));
}

/* =========================
   LOGIN
========================= */
function login(req, res) {
  const { login, password } = req.body;

  if (!login || !password) {
    return res.status(400).json({ message: "Введите логин и пароль" });
  }

  const db = readUsers();
  const user = db.users.find(
    u => u.login === login && u.password === password
  );

  if (!user) {
    return res.status(401).json({ message: "Неверный логин или пароль" });
  }

  const token = jwt.sign(
    {
      id: user.id,
      login: user.login,
      role: user.role
    },
    JWT_SECRET,
    { expiresIn: "2h" }
  );

  res.json({
    token,
    user: {
      id: user.id,
      login: user.login,
      role: user.role,
      email: user.email || '',
      favoriteBooks: user.favoriteBooks || [],
      readHistory: user.readHistory || []
    }
  });
}

/* =========================
   REGISTER
========================= */
function register(req, res) {
  const { login: username, email, password } = req.body;

  if (!username || !password) {
    return res.status(400).json({ message: "Логин и пароль обязательны" });
  }

  const db = readUsers();
  
  // Проверка: существует ли пользователь с таким логином
  const existingUser = db.users.find(u => u.login === username);
  if (existingUser) {
    return res.status(409).json({ message: "Пользователь с таким логином уже существует" });
  }

  const newUser = {
    id: Date.now(),
    login: username,
    email: email || '',
    password: password, // ⚠️ в продакшене нужно хешировать!
    role: "user"
  };

  db.users.push(newUser);
  writeUsers(db);

  const token = jwt.sign(
    {
      id: newUser.id,
      login: newUser.login,
      role: newUser.role
    },
    JWT_SECRET,
    { expiresIn: "2h" }
  );

  res.status(201).json({
    token,
    user: {
      id: newUser.id,
      login: newUser.login,
      email: newUser.email,
      role: newUser.role,
      favoriteBooks: newUser.favoriteBooks || [],
      readHistory: newUser.readHistory || []
    }
  });
}

/* =========================
   GET CURRENT USER
========================= */
function getCurrentUser(req, res) {
  console.log('getCurrentUser: req.user =', req.user);
  const db = readUsers();
  const user = db.users.find(u => u.id === req.user.id);

  if (!user) {
    console.log('getCurrentUser: Пользователь не найден, id =', req.user.id);
    return res.status(404).json({ message: "Пользователь не найден" });
  }

  console.log('getCurrentUser: Найден пользователь', user.login);
  res.json({
    id: user.id,
    login: user.login,
    email: user.email,
    role: user.role,
    favoriteBooks: user.favoriteBooks || [],
    readHistory: user.readHistory || []
  });
}

/* =========================
   MIDDLEWARE
========================= */
function authMiddleware(req, res, next) {
  const authHeader = req.headers.authorization;

  if (!authHeader) {
    console.log('authMiddleware: Нет токена');
    return res.status(401).json({ message: "Нет токена" });
  }

  const token = authHeader.split(" ")[1];
  console.log('authMiddleware: Токен:', token ? token.substring(0, 20) + '...' : 'пустой');

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    console.log('authMiddleware: Decoded:', decoded);
    req.user = decoded;
    next();
  } catch (err) {
    console.log('authMiddleware: Ошибка верификации:', err.message);
    return res.status(403).json({ message: "Неверный токен" });
  }
}

/* =========================
   ADMIN CHECK
========================= */
function adminOnly(req, res, next) {
  if (req.user.role !== "admin") {
    return res.status(403).json({ message: "Доступ запрещён" });
  }
  next();
}

module.exports = {
  login,
  authMiddleware,
  adminOnly,
  register,
  getCurrentUser
};
