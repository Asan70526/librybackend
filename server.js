const express = require("express");
const cors = require("cors");
const fs = require("fs");
const path = require("path");
const multer = require("multer");

const { login, authMiddleware, adminOnly, register, getCurrentUser } = require("./auth");

const app = express();
const PORT = 3000;

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const uploadsDir = path.join(__dirname, "uploads");
    if (!fs.existsSync(uploadsDir)) {
      fs.mkdirSync(uploadsDir, { recursive: true });
    }
    cb(null, uploadsDir);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + "-" + Math.round(Math.random() * 1E9);
    cb(null, uniqueSuffix + path.extname(file.originalname));
  }
});

const upload = multer({
  storage: storage
});

app.use(cors());
app.use(express.json());

// Маршрут для файла переводов
app.get("/lang.json", (req, res) => {
  const filePath = path.join(__dirname, "../lang.json");
  if (fs.existsSync(filePath)) {
    res.sendFile(filePath);
  } else {
    res.status(404).send('File not found');
  }
});

/* =========================
   AUTH ROUTES (до static!)
========================= */
app.post("/login", login);
app.post("/register", register);
app.get("/me", authMiddleware, getCurrentUser);
app.post("/logout", (req, res) => {
  res.json({ success: true, message: "Logged out" });
});

/* =========================
   USER DATA ROUTES (до static!)
========================= */
app.get("/users/:id", authMiddleware, (req, res) => {
  const usersDb = JSON.parse(fs.readFileSync(path.join(__dirname, "users.json")));
  const user = usersDb.users.find(u => u.id == req.params.id);

  if (!user) {
    return res.status(404).json({ message: "Пользователь не найден" });
  }

  delete user.password;
  res.json(user);
});

app.put("/users/:id", authMiddleware, (req, res) => {
  const usersDb = JSON.parse(fs.readFileSync(path.join(__dirname, "users.json")));
  const index = usersDb.users.findIndex(u => u.id == req.params.id);

  if (index === -1) {
    return res.status(404).json({ message: "Пользователь не найден" });
  }

  const allowedFields = ['favoriteBooks', 'readHistory', 'email'];
  allowedFields.forEach(field => {
    if (req.body[field] !== undefined) {
      usersDb.users[index][field] = req.body[field];
    }
  });

  fs.writeFileSync(path.join(__dirname, "users.json"), JSON.stringify(usersDb, null, 2));
  res.json(usersDb.users[index]);
});

app.post("/users/:id/favorites/:bookId", authMiddleware, (req, res) => {
  const usersDb = JSON.parse(fs.readFileSync(path.join(__dirname, "users.json")));
  const index = usersDb.users.findIndex(u => u.id == req.params.id);

  if (index === -1) {
    return res.status(404).json({ message: "Пользователь не найден" });
  }

  const bookId = parseInt(req.params.bookId);
  if (!usersDb.users[index].favoriteBooks) {
    usersDb.users[index].favoriteBooks = [];
  }

  if (!usersDb.users[index].favoriteBooks.includes(bookId)) {
    usersDb.users[index].favoriteBooks.push(bookId);
  }

  fs.writeFileSync(path.join(__dirname, "users.json"), JSON.stringify(usersDb, null, 2));
  res.json({ success: true, favoriteBooks: usersDb.users[index].favoriteBooks });
});

app.delete("/users/:id/favorites/:bookId", authMiddleware, (req, res) => {
  const usersDb = JSON.parse(fs.readFileSync(path.join(__dirname, "users.json")));
  const index = usersDb.users.findIndex(u => u.id == req.params.id);

  if (index === -1) {
    return res.status(404).json({ message: "Пользователь не найден" });
  }

  const bookId = parseInt(req.params.bookId);
  usersDb.users[index].favoriteBooks = usersDb.users[index].favoriteBooks.filter(id => id !== bookId);

  fs.writeFileSync(path.join(__dirname, "users.json"), JSON.stringify(usersDb, null, 2));
  res.json({ success: true, favoriteBooks: usersDb.users[index].favoriteBooks });
});

/* =========================
   USER MANAGEMENT (Admin Only)
========================= */
// Получить всех пользователей
app.get("/users", authMiddleware, adminOnly, (req, res) => {
  const usersDb = JSON.parse(fs.readFileSync(path.join(__dirname, "users.json")));
  const users = usersDb.users.map(user => {
    const { password, ...userWithoutPassword } = user;
    return userWithoutPassword;
  });
  res.json(users);
});

// Создать пользователя
app.post("/users", authMiddleware, adminOnly, (req, res) => {
  const usersDb = JSON.parse(fs.readFileSync(path.join(__dirname, "users.json")));
  
  const { login: username, email, password, role, firstName, lastName } = req.body;
  
  if (!username || !password) {
    return res.status(400).json({ message: "Логин и пароль обязательны" });
  }
  
  const existingUser = usersDb.users.find(u => u.login === username);
  if (existingUser) {
    return res.status(409).json({ message: "Пользователь с таким логином уже существует" });
  }
  
  const newUser = {
    id: Date.now(),
    login: username,
    email: email || '',
    firstName: firstName || '',
    lastName: lastName || '',
    password: password,
    role: role || 'user',
    favoriteBooks: [],
    readHistory: []
  };
  
  usersDb.users.push(newUser);
  fs.writeFileSync(path.join(__dirname, "users.json"), JSON.stringify(usersDb, null, 2));
  
  const { password: _, ...userWithoutPassword } = newUser;
  res.json(userWithoutPassword);
});

// Удалить пользователя
app.delete("/users/:id", authMiddleware, adminOnly, (req, res) => {
  const usersDb = JSON.parse(fs.readFileSync(path.join(__dirname, "users.json")));
  const index = usersDb.users.findIndex(u => u.id == req.params.id);
  
  if (index === -1) {
    return res.status(404).json({ message: "Пользователь не найден" });
  }
  
  usersDb.users.splice(index, 1);
  fs.writeFileSync(path.join(__dirname, "users.json"), JSON.stringify(usersDb, null, 2));
  
  res.json({ success: true, message: "Пользователь удалён" });
});

// Обновить пользователя
app.put("/users/:id", authMiddleware, (req, res) => {
  const usersDb = JSON.parse(fs.readFileSync(path.join(__dirname, "users.json")));
  const index = usersDb.users.findIndex(u => u.id == req.params.id);
  
  if (index === -1) {
    return res.status(404).json({ message: "Пользователь не найден" });
  }
  
  const allowedFields = ['favoriteBooks', 'readHistory', 'email', 'firstName', 'lastName'];
  allowedFields.forEach(field => {
    if (req.body[field] !== undefined) {
      usersDb.users[index][field] = req.body[field];
    }
  });
  
  fs.writeFileSync(path.join(__dirname, "users.json"), JSON.stringify(usersDb, null, 2));
  const { password, ...userWithoutPassword } = usersDb.users[index];
  res.json(userWithoutPassword);
});

app.post("/users/:id/history/:bookId", authMiddleware, (req, res) => {
  const usersDb = JSON.parse(fs.readFileSync(path.join(__dirname, "users.json")));
  const index = usersDb.users.findIndex(u => u.id == req.params.id);

  if (index === -1) {
    return res.status(404).json({ message: "Пользователь не найден" });
  }

  const bookId = parseInt(req.params.bookId);
  if (!usersDb.users[index].readHistory) {
    usersDb.users[index].readHistory = [];
  }

  const existingIndex = usersDb.users[index].readHistory.indexOf(bookId);
  if (existingIndex !== -1) {
    usersDb.users[index].readHistory.splice(existingIndex, 1);
  }
  usersDb.users[index].readHistory.unshift(bookId);

  fs.writeFileSync(path.join(__dirname, "users.json"), JSON.stringify(usersDb, null, 2));
  res.json({ success: true, readHistory: usersDb.users[index].readHistory });
});

/* =========================
   PUBLIC BOOK ROUTES
========================= */
app.get("/books", (req, res) => {
  const DB_PATH = path.join(__dirname, "db.json");
  if (!fs.existsSync(DB_PATH)) {
    fs.writeFileSync(DB_PATH, JSON.stringify({ books: [] }, null, 2));
  }
  const db = JSON.parse(fs.readFileSync(DB_PATH));
  res.json(db.books);
});

app.get("/books/:id", (req, res) => {
  const DB_PATH = path.join(__dirname, "db.json");
  const db = JSON.parse(fs.readFileSync(DB_PATH));
  const book = db.books.find(b => b.id == Number(req.params.id));
  
  if (!book) {
    return res.status(404).json({ message: "Книга не найдена" });
  }
  
  res.json(book);
});

app.post("/books", authMiddleware, adminOnly, (req, res) => {
  const DB_PATH = path.join(__dirname, "db.json");
  const db = JSON.parse(fs.readFileSync(DB_PATH));

  const newId = db.books.length > 0 
    ? Math.max(...db.books.map(b => b.id)) + 1 
    : 1;

  const book = {
    id: newId,
    title: req.body.title,
    author: req.body.author,
    genre: req.body.genre,
    year: req.body.year,
    description: req.body.description,
    text: req.body.text,
    cover: req.body.cover
  };

  db.books.push(book);
  fs.writeFileSync(DB_PATH, JSON.stringify(db, null, 2));
  res.json(book);
});

app.delete("/books/:id", authMiddleware, adminOnly, (req, res) => {
  const DB_PATH = path.join(__dirname, "db.json");
  const db = JSON.parse(fs.readFileSync(DB_PATH));
  const book = db.books.find(b => b.id == Number(req.params.id));
  
  if (book && book.pdf) {
    const pdfPath = path.join(__dirname, "uploads", book.pdf);
    if (fs.existsSync(pdfPath)) {
      fs.unlinkSync(pdfPath);
    }
  }
  
  db.books = db.books.filter(b => b.id != Number(req.params.id));
  fs.writeFileSync(DB_PATH, JSON.stringify(db, null, 2));
  res.json({ success: true });
});

app.put("/books/:id", authMiddleware, adminOnly, (req, res) => {
  const DB_PATH = path.join(__dirname, "db.json");
  const db = JSON.parse(fs.readFileSync(DB_PATH));
  const index = db.books.findIndex(b => b.id == Number(req.params.id));
  
  if (index === -1) {
    return res.status(404).json({ message: "Книга не найдена" });
  }
  
  const { title, author, genre, year, description, text } = req.body;
  if (title) db.books[index].title = title;
  if (author) db.books[index].author = author;
  if (genre) db.books[index].genre = genre;
  if (year) db.books[index].year = Number(year);
  if (description) db.books[index].description = description;
  if (text) db.books[index].text = text;
  
  fs.writeFileSync(DB_PATH, JSON.stringify(db, null, 2));
  res.json(db.books[index]);
});

app.post("/books/:id/pdf", authMiddleware, adminOnly, upload.single("pdf"), (req, res) => {
  console.log('PDF upload for book:', req.params.id, 'file:', req.file);
  
  try {
    const DB_PATH = path.join(__dirname, "db.json");
    const db = JSON.parse(fs.readFileSync(DB_PATH));
    const index = db.books.findIndex(b => b.id == Number(req.params.id));
    
    if (index === -1) {
      return res.status(404).json({ message: "Книга не найдена" });
    }
    
    if (!req.file) {
      return res.status(400).json({ message: "PDF файл не загружен" });
    }
    
    if (db.books[index].pdf) {
      const oldPdfPath = path.join(__dirname, "uploads", db.books[index].pdf);
      if (fs.existsSync(oldPdfPath)) {
        fs.unlinkSync(oldPdfPath);
      }
    }
    
    db.books[index].pdf = req.file.filename;
    fs.writeFileSync(DB_PATH, JSON.stringify(db, null, 2));
    res.json({ success: true, pdf: req.file.filename });
  } catch (e) {
    console.error('PDF upload error:', e);
    res.status(500).json({ message: "Ошибка сервера: " + e.message });
  }
});

// Delete PDF file for a book
app.delete("/books/:id/pdf", authMiddleware, adminOnly, (req, res) => {
  try {
    const DB_PATH = path.join(__dirname, "db.json");
    const db = JSON.parse(fs.readFileSync(DB_PATH));
    const index = db.books.findIndex(b => b.id == Number(req.params.id));

    if (index === -1) {
      return res.status(404).json({ message: "Книга не найдена" });
    }

    const pdfFile = db.books[index].pdf;
    if (pdfFile) {
      const pdfPath = path.join(__dirname, "uploads", pdfFile);
      if (fs.existsSync(pdfPath)) {
        fs.unlinkSync(pdfPath);
      }
    }

    db.books[index].pdf = "";
    fs.writeFileSync(DB_PATH, JSON.stringify(db, null, 2));
    res.json({ success: true });
  } catch (e) {
    console.error('PDF delete error:', e);
    res.status(500).json({ message: "Ошибка сервера: " + e.message });
  }
});

// Upload cover image for a book (stored in db.json as filename)
app.post("/books/:id/cover", authMiddleware, adminOnly, upload.single("cover"), (req, res) => {
  try {
    const DB_PATH = path.join(__dirname, "db.json");
    const db = JSON.parse(fs.readFileSync(DB_PATH));
    const index = db.books.findIndex(b => b.id == Number(req.params.id));
    
    if (index === -1) {
      return res.status(404).json({ message: "Книга не найдена" });
    }
    
    if (!req.file) {
      return res.status(400).json({ message: "Файл обложки не загружен" });
    }

    // Remove old cover file if it exists in uploads
    if (db.books[index].cover) {
      const oldCoverPath = path.join(__dirname, "uploads", db.books[index].cover);
      if (fs.existsSync(oldCoverPath)) {
        fs.unlinkSync(oldCoverPath);
      }
    }

    db.books[index].cover = req.file.filename;
    fs.writeFileSync(DB_PATH, JSON.stringify(db, null, 2));
    res.json({ success: true, cover: req.file.filename });
  } catch (e) {
    console.error('Cover upload error:', e);
    res.status(500).json({ message: "Ошибка сервера: " + e.message });
  }
});

// Delete cover image for a book
app.delete("/books/:id/cover", authMiddleware, adminOnly, (req, res) => {
  try {
    const DB_PATH = path.join(__dirname, "db.json");
    const db = JSON.parse(fs.readFileSync(DB_PATH));
    const index = db.books.findIndex(b => b.id == Number(req.params.id));

    if (index === -1) {
      return res.status(404).json({ message: "Книга не найдена" });
    }

    const coverFile = db.books[index].cover;
    if (coverFile) {
      const coverPath = path.join(__dirname, "uploads", coverFile);
      if (fs.existsSync(coverPath)) {
        fs.unlinkSync(coverPath);
      }
    }

    db.books[index].cover = "";
    fs.writeFileSync(DB_PATH, JSON.stringify(db, null, 2));
    res.json({ success: true });
  } catch (e) {
    console.error('Cover delete error:', e);
    res.status(500).json({ message: "Ошибка сервера: " + e.message });
  }
});

/* =========================
   STATISTICS (Admin Only)
======================== */
app.get("/statistics", authMiddleware, adminOnly, (req, res) => {
  const usersDb = JSON.parse(fs.readFileSync(path.join(__dirname, "users.json")));
  const DB_PATH = path.join(__dirname, "db.json");
  const db = JSON.parse(fs.readFileSync(DB_PATH));
  
  const totalUsers = usersDb.users.length;
  const totalBooks = db.books.length;
  const totalReads = usersDb.users.reduce((sum, user) => sum + (user.readHistory?.length || 0), 0);
  const avgRating = 4.5; // Заглушка, пока нет рейтингов
  
  res.json({
    totalUsers,
    totalBooks,
    totalReads,
    avgRating
  });
});

// Public home stats for main menu (books/genres/readers/reads)
app.get("/home-statistics", (req, res) => {
  try {
    const usersDb = JSON.parse(fs.readFileSync(path.join(__dirname, "users.json")));
    const db = JSON.parse(fs.readFileSync(path.join(__dirname, "db.json")));

    const totalUsers = usersDb.users.length;
    const totalBooks = db.books.length;
    const totalReads = usersDb.users.reduce((sum, user) => sum + (user.readHistory?.length || 0), 0);
    const totalReaders = usersDb.users.filter(user => (user.readHistory?.length || 0) > 0).length;

    const genresSet = new Set((db.books || []).map(b => b.genre).filter(Boolean));
    const totalGenres = genresSet.size;

    res.json({
      totalUsers,
      totalBooks,
      totalGenres,
      totalReaders,
      totalReads
    });
  } catch (e) {
    res.status(500).json({ message: "Ошибка сервера: " + e.message });
  }
});

/* =========================
   STATIC FILES (после API!)
========================= */
app.use(express.static("../frontend"));
app.use("/libry/css", express.static("../css"));
app.use("/libry/js", express.static("../js"));
app.use("/libry/texture", express.static("../texture"));
app.use("/libry/backend/uploads", express.static("uploads"));
app.use("/css", express.static("../css"));
app.use("/js", express.static("../js"));
app.use("/texture", express.static("../texture"));
app.use("/uploads", express.static("uploads"));

/* =========================
   START
========================= */
app.listen(PORT, () => {
  console.log(`✅ Server running: http://localhost:${PORT}`);
  console.log(`✅ API routes available before static files`);
});
