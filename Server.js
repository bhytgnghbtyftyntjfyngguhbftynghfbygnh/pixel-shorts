const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');

let ngrok;
try {
  ngrok = require('@ngrok/ngrok');
} catch (e) {
  ngrok = null;
}

const app = express();
const PORT = 3000;
const NGROK_AUTHTOKEN = '3K0UZPjWByV1Dv3yfFhORZ5Pxlq_2onbeSQiiaKzVNUiRVMLY';

const GALLERY_FILE = path.join(__dirname, 'gallery.json');
const USERS_FILE = path.join(__dirname, 'users.json');

if (!fs.existsSync('./uploads')) {
  fs.mkdirSync('./uploads');
}

let pixelArtGallery = [];
let users = [];
let activeSessions = {};

if (fs.existsSync(GALLERY_FILE)) {
  try { pixelArtGallery = JSON.parse(fs.readFileSync(GALLERY_FILE, 'utf8')); } catch (e) { pixelArtGallery = []; }
}
if (fs.existsSync(USERS_FILE)) {
  try { users = JSON.parse(fs.readFileSync(USERS_FILE, 'utf8')); } catch (e) { users = []; }
}

function saveGallery() {
  fs.writeFileSync(GALLERY_FILE, JSON.stringify(pixelArtGallery, null, 2));
}

function saveUsers() {
  fs.writeFileSync(USERS_FILE, JSON.stringify(users, null, 2));
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, 'uploads/'),
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    const ext = path.extname(file.originalname);
    cb(null, 'pixel-' + uniqueSuffix + ext);
  }
});

const upload = multer({
  storage: storage,
  limits: { fileSize: 200 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowedTypes = ['image/png', 'image/jpeg', 'image/jpg', 'video/mp4'];
    if (allowedTypes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Alleen .png, .jpg en .mp4 bestanden zijn toegestaan!'));
    }
  }
});

app.use('/uploads', express.static(path.join(__dirname, 'uploads')));
app.use(express.json({ limit: '200mb' }));
app.use(express.urlencoded({ limit: '200mb', extended: true }));

function getLoggedInUser(req) {
  const token = req.headers['authorization'];
  if (token && activeSessions[token]) {
    return activeSessions[token];
  }
  return null;
}

// --- AUTH & USER API ---
app.post('/api/register', (req, res) => {
  if (!Array.isArray(users)) users = [];
  const { username, password } = req.body;
  if (!username || !password) return res.status(400).json({ error: 'Vul alle velden in.' });
  const cleanUser = username.trim();
  
  if (users.find(u => u.username.toLowerCase() === cleanUser.toLowerCase())) {
    return res.status(400).json({ error: 'Gebruikersnaam bestaat al.' });
  }

  const newUser = {
    username: cleanUser,
    password,
    profilePic: '/uploads/default-avatar.png',
    bio: 'Pixel art & video creator!',
    following: [],
    followers: []
  };

  users.push(newUser);
  saveUsers();

  const token = 'token-' + Date.now() + '-' + Math.random();
  activeSessions[token] = cleanUser;

  res.json({ message: 'Account aangemaakt!', username: cleanUser, token });
});

app.post('/api/login', (req, res) => {
  if (!Array.isArray(users)) users = [];
  const { username, password } = req.body;
  if (!username || !password) return res.status(400).json({ error: 'Vul alle velden in.' });

  const user = users.find(u => u.username.toLowerCase() === username.trim().toLowerCase() && u.password === password);
  if (!user) return res.status(401).json({ error: 'Ongeldige inloggegevens.' });

  const token = 'token-' + Date.now() + '-' + Math.random();
  activeSessions[token] = user.username;

  res.json({ message: 'Ingelogd!', username: user.username, token });
});

app.post('/api/logout', (req, res) => {
  const token = req.headers['authorization'];
  if (token) delete activeSessions[token];
  res.json({ message: 'Uitgelogd' });
});

app.get('/api/me', (req, res) => {
  const username = getLoggedInUser(req);
  if (!username) return res.json({ loggedIn: false });
  const user = users.find(u => u.username.toLowerCase() === username.toLowerCase());
  res.json({ loggedIn: true, username, profilePic: user ? user.profilePic : '', bio: user ? user.bio : '' });
});

// Profiel gegevens van een specifieke gebruiker ophalen
app.get('/api/user/:username', (req, res) => {
  const targetName = req.params.username.toLowerCase();
  const user = users.find(u => u.username.toLowerCase() === targetName);
  if (!user) return res.status(404).json({ error: 'Gebruiker niet gevonden.' });

  const userArtworks = pixelArtGallery.filter(a => a.author.toLowerCase() === targetName);

  res.json({
    username: user.username,
    profilePic: user.profilePic || '',
    bio: user.bio || '',
    followersCount: user.followers ? user.followers.length : 0,
    followingCount: user.following ? user.following.length : 0,
    artworks: userArtworks
  });
});

// Profiel bijwerken (Bio of Proielfoto)
app.post('/api/profile/update', upload.single('profilePic'), (req, res) => {
  const username = getLoggedInUser(req);
  if (!username) return res.status(401).json({ error: 'Niet ingelogd.' });

  const user = users.find(u => u.username.toLowerCase() === username.toLowerCase());
  if (!user) return res.status(404).json({ error: 'Gebruiker niet gevonden.' });

  if (req.body.bio !== undefined) {
    user.bio = req.body.bio.trim();
  }
  if (req.file) {
    user.profilePic = `/uploads/${req.file.filename}`;
  }

  saveUsers();
  res.json({ message: 'Profiel geüpdatet!', profilePic: user.profilePic, bio: user.bio });
});

// Volgen / Ontvolgen API
app.post('/api/user/:username/follow', (req, res) => {
  const currentUsername = getLoggedInUser(req);
  if (!currentUsername) return res.status(401).json({ error: 'Log in om te volgen.' });

  const targetName = req.params.username.toLowerCase();
  if (currentUsername.toLowerCase() === targetName) {
    return res.status(400).json({ error: 'Je kunt jezelf niet volgen.' });
  }

  const currentUser = users.find(u => u.username.toLowerCase() === currentUsername.toLowerCase());
  const targetUser = users.find(u => u.username.toLowerCase() === targetName);

  if (!targetUser) return res.status(404).json({ error: 'Gebruiker niet gevonden.' });

  if (!currentUser.following) currentUser.following = [];
  if (!targetUser.followers) targetUser.followers = [];

  const index = currentUser.following.indexOf(targetUser.username);
  let isFollowing = false;

  if (index === -1) {
    currentUser.following.push(targetUser.username);
    targetUser.followers.push(currentUser.username);
    isFollowing = true;
  } else {
    currentUser.following.splice(index, 1);
    const targetIndex = targetUser.followers.indexOf(currentUser.username);
    if (targetIndex !== -1) targetUser.followers.splice(targetIndex, 1);
    isFollowing = false;
  }

  saveUsers();
  res.json({ isFollowing, followersCount: targetUser.followers.length });
});

// --- GALLERY & INTERACTION API ---
app.get('/api/gallery', (req, res) => {
  res.json(pixelArtGallery);
});

app.post('/api/upload', upload.single('pixelart'), (req, res) => {
  const username = getLoggedInUser(req);
  if (!username) return res.status(401).json({ error: 'Je moet ingelogd zijn.' });
  if (!req.file) return res.status(400).json({ error: 'Geen bestand geüpload.' });

  const user = users.find(u => u.username.toLowerCase() === username.toLowerCase());
  const title = req.body.title || 'Naamloos Kunstwerk';
  const isVideo = req.file.mimetype === 'video/mp4';

  const newArt = {
    id: Date.now(),
    title: title,
    author: username,
    authorPfp: user ? user.profilePic : '/uploads/default-avatar.png',
    filename: req.file.filename,
    url: `/uploads/${req.file.filename}`,
    isVideo: isVideo,
    likes: [],
    comments: [],
    uploadedAt: Date.now()
  };

  pixelArtGallery.unshift(newArt);
  saveGallery();

  res.json({ message: 'Upload geslaagd!', art: newArt });
});

app.post('/api/art/:id/like', (req, res) => {
  const username = getLoggedInUser(req);
  if (!username) return res.status(401).json({ error: 'Log in om te liken.' });

  const art = pixelArtGallery.find(a => a.id == req.params.id);
  if (!art) return res.status(404).json({ error: 'Niet gevonden.' });

  if (!art.likes) art.likes = [];
  const index = art.likes.indexOf(username);
  let liked = false;

  if (index === -1) {
    art.likes.push(username);
    liked = true;
  } else {
    art.likes.splice(index, 1);
    liked = false;
  }

  saveGallery();
  res.json({ liked, likesCount: art.likes.length });
});

app.post('/api/art/:id/comment', (req, res) => {
  const username = getLoggedInUser(req);
  if (!username) return res.status(401).json({ error: 'Log in om te reageren.' });

  const { text } = req.body;
  if (!text || !text.trim()) return res.status(400).json({ error: 'Typ een reactie.' });

  const art = pixelArtGallery.find(a => a.id == req.params.id);
  if (!art) return res.status(404).json({ error: 'Niet gevonden.' });

  if (!art.comments) art.comments = [];
  const user = users.find(u => u.username.toLowerCase() === username.toLowerCase());
  const newComment = {
    id: Date.now(),
    author: username,
    authorPfp: user ? user.profilePic : '',
    text: text.trim(),
    createdAt: Date.now()
  };

  art.comments.push(newComment);
  saveGallery();

  res.json({ message: 'Reactie geplaatst!', comment: newComment });
});

app.delete('/api/art/:id', (req, res) => {
  const username = getLoggedInUser(req);
  if (!username) return res.status(401).json({ error: 'Niet ingelogd.' });

  const artIndex = pixelArtGallery.findIndex(a => a.id == req.params.id);
  if (artIndex === -1) return res.status(404).json({ error: 'Niet gevonden.' });

  const art = pixelArtGallery[artIndex];
  if (art.author.toLowerCase() !== username.toLowerCase()) {
    return res.status(403).json({ error: 'Niet je eigen kunstwerk.' });
  }

  const filePath = path.join(__dirname, 'uploads', art.filename);
  if (fs.existsSync(filePath)) fs.unlinkSync(filePath);

  pixelArtGallery.splice(artIndex, 1);
  saveGallery();

  res.json({ message: 'Verwijderd!' });
});

// --- FRONTEND HTML ---
app.get('/', (req, res) => {
  res.send(`
<!DOCTYPE html>
<html lang="nl">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
    <title>Pixel Shorts & Video Feed</title>
    
    <script src="https://cdn.tailwindcss.com"></script>
    <link rel="preconnect" href="https://fonts.googleapis.com">
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
    <link href="https://fonts.googleapis.com/css2?family=Press+Start+2P&family=VT323&display=swap" rel="stylesheet">
    <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css">

    <style>
        :root {
            --bg-color: #0d0d15;
            --primary: #f2a65a;
            --secondary: #77c688;
            --danger: #e65f5c;
        }

        body {
            background-color: var(--bg-color);
            color: #fff;
            font-family: 'VT323', monospace;
            font-size: 1.2rem;
            overflow: hidden;
        }

        .pixel-font { font-family: 'Press Start 2P', cursive; }

        .retro-box {
            background-color: #1a1a2e;
            border: 4px solid #000;
            box-shadow: 6px 6px 0px 0px #000;
        }

        .retro-btn {
            background-color: var(--primary);
            border: 4px solid #000;
            box-shadow: 4px 4px 0px 0px #000;
            cursor: pointer;
            text-transform: uppercase;
            color: #000;
            font-family: 'Press Start 2P', cursive;
            font-size: 0.75rem;
            padding: 8px 12px;
            display: inline-block;
            transition: transform 0.1s;
        }

        .retro-btn:active { transform: translate(2px, 2px); }
        .retro-btn:disabled { opacity: 0.6; cursor: not-allowed; }

        .shorts-container {
            scroll-snap-type: y mandatory;
            overflow-y: scroll;
            height: calc(100vh - 65px);
            scroll-behavior: smooth;
        }

        .shorts-item {
            scroll-snap-align: start;
            scroll-snap-stop: always;
            height: calc(100vh - 65px);
            position: relative;
            display: flex;
            align-items: center;
            justify-content: center;
            background-color: #000;
        }

        .pixel-media-full {
            image-rendering: pixelated;
            image-rendering: crisp-edges;
            max-width: 100%;
            max-height: 100%;
            object-fit: contain;
            user-select: none;
        }

        .shorts-container::-webkit-scrollbar { display: none; }
        .shorts-container { -ms-overflow-style: none; scrollbar-width: none; }

        #toast-container {
            position: fixed;
            top: 75px;
            right: 20px;
            z-index: 60;
            display: flex;
            flex-direction: column;
            gap: 10px;
        }

        .toast {
            padding: 12px;
            border: 4px solid #000;
            box-shadow: 4px 4px 0px 0px #000;
            color: #000;
            font-weight: bold;
        }
        .toast.success { background-color: var(--secondary); }
        .toast.error { background-color: var(--danger); color: white; }

        @keyframes heartPop {
            0% { transform: scale(0) rotate(-15deg); opacity: 0; }
            50% { transform: scale(1.4) rotate(0deg); opacity: 1; }
            100% { transform: scale(1) rotate(15deg); opacity: 0; }
        }
        .heart-pop { animation: heartPop 0.8s ease-out forwards; }
    </style>
</head>
<body class="h-screen w-screen flex flex-col justify-between">

    <!-- Top Navigation -->
    <nav class="w-full h-[65px] bg-gray-900 border-b-4 border-black px-4 flex justify-between items-center z-40">
        <div class="flex items-center gap-3">
            <button onclick="toggleSidebar()" class="text-yellow-400 text-2xl hover:scale-110 transition"><i class="fa-solid fa-bars"></i></button>
            <div class="flex items-center gap-2 cursor-pointer" onclick="switchFeed('fyp')">
                <i class="fa-solid fa-film text-yellow-400 text-2xl"></i>
                <span class="pixel-font text-yellow-400 text-xs hidden sm:inline">Pixel Shorts</span>
            </div>
        </div>

        <div class="flex items-center gap-2">
            <button onclick="openModal('upload-modal')" class="retro-btn text-xs bg-yellow-400">
                <i class="fa-solid fa-plus"></i> Upload
            </button>
            <div id="auth-buttons" class="flex gap-2">
                <button onclick="toggleAuthModal('login')" class="retro-btn text-xs">Login</button>
            </div>
            <div id="logout-container" class="hidden flex gap-2 items-center">
                <img id="nav-user-pfp" src="" class="w-8 h-8 rounded-full border-2 border-yellow-400 object-cover cursor-pointer" onclick="openMyProfile()" alt="PFP">
                <button onclick="logout()" class="retro-btn bg-red-500 text-white text-xs"><i class="fa-solid fa-right-from-bracket"></i></button>
            </div>
        </div>
    </nav>

    <!-- Linker Sidebar (Zijbalk) -->
    <div id="sidebar" class="fixed inset-y-0 left-0 w-64 bg-gray-900 border-r-4 border-black z-50 transform -translate-x-full transition-transform duration-300 flex flex-col p-4 shadow-2xl">
        <div class="flex justify-between items-center mb-8 border-b-2 border-black pb-3">
            <h2 class="pixel-font text-yellow-400 text-xs">Menu</h2>
            <button onclick="toggleSidebar()" class="text-red-500 text-2xl font-bold">&times;</button>
        </div>

        <div class="flex flex-col gap-4 flex-grow">
            <button onclick="switchFeed('fyp'); toggleSidebar();" class="flex items-center gap-3 p-3 bg-gray-800 border-2 border-black hover:bg-yellow-400 hover:text-black font-bold text-sm transition text-left">
                <i class="fa-solid fa-fire text-yellow-400 text-lg"></i> FYP Feed
            </button>
            <button onclick="switchFeed('following'); toggleSidebar();" class="flex items-center gap-3 p-3 bg-gray-800 border-2 border-black hover:bg-yellow-400 hover:text-black font-bold text-sm transition text-left">
                <i class="fa-solid fa-user-group text-blue-400 text-lg"></i> Follows Feed
            </button>
            <button onclick="openMyProfile(); toggleSidebar();" class="flex items-center gap-3 p-3 bg-gray-800 border-2 border-black hover:bg-yellow-400 hover:text-black font-bold text-sm transition text-left">
                <i class="fa-solid fa-user text-green-400 text-lg"></i> Profile
            </button>
            <button onclick="openSettings(); toggleSidebar();" class="flex items-center gap-3 p-3 bg-gray-800 border-2 border-black hover:bg-yellow-400 hover:text-black font-bold text-sm transition text-left">
                <i class="fa-solid fa-gear text-purple-400 text-lg"></i> Settings
            </button>
        </div>
    </div>

    <!-- Shorts Feed Container -->
    <main id="shorts-feed" class="shorts-container w-full bg-black relative">
        <!-- Dynamische inhoud -->
    </main>

    <!-- Modal: Profile Page (TikTok Style) -->
    <div id="profile-modal" class="fixed inset-0 bg-black/80 hidden flex justify-center items-center z-50 p-2 sm:p-4">
        <div class="retro-box w-full max-w-lg h-[90vh] flex flex-col p-6 relative overflow-y-auto bg-gray-900">
            <button onclick="closeModal('profile-modal')" class="absolute top-4 right-5 text-2xl text-red-500 font-bold">&times;</button>
            
            <div class="flex flex-col items-center text-center border-b-4 border-black pb-6 mb-4">
                <img id="profile-avatar" src="" class="w-24 h-24 rounded-full border-4 border-yellow-400 object-cover mb-3 shadow-lg" alt="Avatar">
                <h2 id="profile-username" class="pixel-font text-yellow-400 text-base mb-1">@username</h2>
                <p id="profile-bio" class="text-sm text-gray-300 max-w-xs mb-4">Bio...</p>
                
                <div class="flex gap-6 mb-4 text-sm font-bold">
                    <div><span id="profile-following-count" class="text-yellow-400">0</span> Volgend</div>
                    <div><span id="profile-followers-count" class="text-yellow-400">0</span> Volgers</div>
                </div>

                <div id="profile-action-container">
                    <!-- Dynamische volg/bewerk knop -->
                </div>
            </div>

            <h3 class="pixel-font text-xs text-yellow-300 mb-3"><i class="fa-solid fa-grid mr-2"></i>Kunstwerken & Videos</h3>
            <div id="profile-grid" class="grid grid-cols-3 gap-2 overflow-y-auto">
                <!-- User posts grid -->
            </div>
        </div>
    </div>

    <!-- Modal: Settings -->
    <div id="settings-modal" class="fixed inset-0 bg-black/80 hidden flex justify-center items-center z-50 p-4">
        <div class="retro-box p-6 w-full max-w-md relative bg-gray-900">
            <button onclick="closeModal('settings-modal')" class="absolute top-2 right-4 text-2xl text-red-500 font-bold">&times;</button>
            <h2 class="pixel-font text-yellow-300 mb-4 text-center text-sm">Instellingen / Profiel Bewerken</h2>
            
            <form id="settings-form" class="flex flex-col gap-4">
                <label class="text-xs font-bold text-gray-300">Nieuwe Profielfoto:</label>
                <input type="file" id="settings-pfp-input" accept=".png, .jpg, .jpeg" class="p-2 border-2 border-black bg-white text-black text-sm">

                <label class="text-xs font-bold text-gray-300">Jouw Bio:</label>
                <textarea id="settings-bio-input" rows="3" class="p-3 border-4 border-black text-black font-bold outline-none text-sm resize-none" maxlength="120" placeholder="Vertel iets over jezelf..."></textarea>

                <button type="submit" class="retro-btn w-full text-center bg-yellow-400">Opslaan</button>
            </form>
        </div>
    </div>

    <!-- Modal: Comments Slide-over -->
    <div id="comments-modal" class="fixed inset-0 bg-black/70 hidden flex justify-end z-50">
        <div class="w-full sm:w-96 bg-gray-900 border-l-4 border-black h-full flex flex-col p-4 relative">
            <button onclick="closeModal('comments-modal')" class="absolute top-3 right-4 text-2xl text-red-500 font-bold">&times;</button>
            <h2 class="pixel-font text-yellow-400 text-sm mb-4"><i class="fa-solid fa-comments mr-2"></i>Reacties</h2>

            <div id="comments-list" class="flex-grow overflow-y-auto flex flex-col gap-3 my-2 pr-1"></div>

            <form id="comment-form" class="flex gap-2 mt-2">
                <input type="text" id="comment-input" placeholder="Typ een reactie..." class="flex-grow p-2 text-black font-bold border-2 border-black text-sm outline-none" required>
                <button type="submit" class="retro-btn bg-green-400 text-xs"><i class="fa-solid fa-paper-plane"></i></button>
            </form>
        </div>
    </div>

    <!-- Modal: Upload -->
    <div id="upload-modal" class="fixed inset-0 bg-black/80 hidden flex justify-center items-center p-4 z-50">
        <div class="retro-box p-6 w-full max-w-md relative bg-gray-900">
            <button onclick="closeModal('upload-modal')" class="absolute top-2 right-4 text-2xl text-red-500 font-bold">&times;</button>
            <h2 class="pixel-font text-yellow-300 mb-4 text-center text-sm">Upload Media (max 200MB)</h2>
            
            <form id="upload-form" class="flex flex-col gap-4">
                <label class="bg-white text-black border-4 border-dashed border-black p-6 text-center cursor-pointer">
                    <i class="fa-solid fa-file-video text-3xl mb-2"></i><br>
                    <span id="file-name-display" class="font-bold">Kies .png, .jpg of .mp4</span>
                    <input type="file" id="image-input" accept=".png, .jpg, .jpeg, .mp4" class="hidden" required>
                </label>

                <input type="text" id="art-title" placeholder="Titel..." class="p-3 border-4 border-black text-black font-bold outline-none text-sm" maxlength="30" required>

                <div id="progress-container" class="hidden flex flex-col gap-1">
                    <div class="w-full bg-gray-700 h-6 border-2 border-black relative overflow-hidden">
                        <div id="progress-bar" class="bg-green-400 h-full w-0 transition-all duration-100"></div>
                        <span id="progress-text" class="absolute inset-0 flex items-center justify-center text-xs font-bold text-black drop-shadow">0%</span>
                    </div>
                </div>

                <button type="submit" id="upload-submit-btn" class="retro-btn w-full text-center">Publiceren</button>
            </form>
        </div>
    </div>

    <!-- Modal: Auth -->
    <div id="auth-modal" class="fixed inset-0 bg-black/80 hidden flex justify-center items-center p-4 z-50">
        <div class="retro-box p-6 w-full max-w-md relative bg-gray-900">
            <button onclick="closeModal('auth-modal')" class="absolute top-2 right-4 text-2xl text-red-500 font-bold">&times;</button>
            <h2 id="modal-title" class="pixel-font text-yellow-300 mb-4 text-center text-sm">Inloggen</h2>
            
            <form id="auth-form" class="flex flex-col gap-4">
                <input type="text" id="auth-username" placeholder="Gebruikersnaam" class="p-3 border-4 border-black text-black font-bold outline-none text-sm" required>
                <input type="password" id="auth-password" placeholder="Wachtwoord" class="p-3 border-4 border-black text-black font-bold outline-none text-sm" required>
                <button type="submit" id="auth-submit-btn" class="retro-btn w-full text-center">Inloggen</button>
            </form>
            <div class="mt-4 text-center">
                <button onclick="switchAuthMode()" id="auth-switch-btn" class="text-xs text-yellow-400 underline">Nog geen account? Registreer hier.</button>
            </div>
        </div>
    </div>

    <div id="toast-container"></div>

    <script>
        let allArtworks = [];
        let currentFeedType = 'fyp'; // 'fyp' of 'following'
        let authMode = 'login';
        let currentLoggedInUser = null;
        let currentUserPfp = '';
        let activeArtIdForComments = null;

        const shortsFeed = document.getElementById('shorts-feed');
        const fileInput = document.getElementById('image-input');
        const fileNameDisplay = document.getElementById('file-name-display');
        const toastContainer = document.getElementById('toast-container');
        const sidebar = document.getElementById('sidebar');

        function toggleSidebar() {
            sidebar.classList.toggle('-translate-x-full');
        }

        function playRetroSound(freq = 587.33, duration = 0.1) {
            try {
                const ctx = new (window.AudioContext || window.webkitAudioContext)();
                const osc = ctx.createOscillator();
                const gain = ctx.createGain();
                osc.type = 'square';
                osc.frequency.setValueAtTime(freq, ctx.currentTime);
                gain.gain.setValueAtTime(0.1, ctx.currentTime);
                osc.connect(gain);
                gain.connect(ctx.destination);
                osc.start();
                osc.stop(ctx.currentTime + duration);
            } catch (e) {}
        }

        function getToken() { return localStorage.getItem('pixelToken') || ''; }
        function setToken(token) { localStorage.setItem('pixelToken', token); }
        function removeToken() { localStorage.removeItem('pixelToken'); }

        function showToast(msg, type = 'success') {
            const toast = document.createElement('div');
            toast.className = 'toast ' + type;
            toast.innerText = msg;
            toastContainer.appendChild(toast);
            setTimeout(() => toast.remove(), 2500);
        }

        function openModal(id) { document.getElementById(id).classList.remove('hidden'); }
        function closeModal(id) { document.getElementById(id).classList.add('hidden'); }

        async function checkAuth() {
            const token = getToken();
            if (!token) {
                currentLoggedInUser = null;
                currentUserPfp = '';
                updateAuthUI(null);
                return;
            }
            try {
                const res = await fetch('/api/me', { headers: { 'Authorization': token } });
                const data = await res.json();
                if (data.loggedIn) {
                    currentLoggedInUser = data.username;
                    currentUserPfp = data.profilePic || '/uploads/default-avatar.png';
                    updateAuthUI(data.username, currentUserPfp);
                } else {
                    removeToken();
                    currentLoggedInUser = null;
                    currentUserPfp = '';
                    updateAuthUI(null);
                }
            } catch (err) {
                currentLoggedInUser = null;
                updateAuthUI(null);
            }
        }

        function updateAuthUI(username, pfp) {
            const authButtons = document.getElementById('auth-buttons');
            const logoutContainer = document.getElementById('logout-container');
            const navPfp = document.getElementById('nav-user-pfp');

            if (username) {
                authButtons.classList.add('hidden');
                logoutContainer.classList.remove('hidden');
                if (pfp) navPfp.src = pfp;
            } else {
                authButtons.classList.remove('hidden');
                logoutContainer.classList.add('hidden');
            }
        }

        function toggleAuthModal(mode) {
            authMode = mode || 'login';
            document.getElementById('modal-title').textContent = authMode === 'login' ? 'Inloggen' : 'Registreren';
            document.getElementById('auth-submit-btn').textContent = authMode === 'login' ? 'Inloggen' : 'Account Aanmaken';
            document.getElementById('auth-switch-btn').textContent = authMode === 'login' ? 'Nog geen account? Registreer hier.' : 'Al een account? Log in.';
            openModal('auth-modal');
        }

        function switchAuthMode() {
            toggleAuthModal(authMode === 'login' ? 'register' : 'login');
        }

        document.getElementById('auth-form').addEventListener('submit', async (e) => {
            e.preventDefault();
            const username = document.getElementById('auth-username').value;
            const password = document.getElementById('auth-password').value;
            const endpoint = authMode === 'login' ? '/api/login' : '/api/register';

            try {
                const res = await fetch(endpoint, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ username, password })
                });

                const data = await res.json();
                if (res.ok) {
                    setToken(data.token);
                    showToast(data.message);
                    closeModal('auth-modal');
                    await checkAuth();
                    fetchGallery();
                } else {
                    showToast(data.error || 'Er ging iets mis', 'error');
                }
            } catch (err) {
                showToast('Serverfout bij inloggen', 'error');
            }
        });

        async function logout() {
            await fetch('/api/logout', { method: 'POST', headers: { 'Authorization': getToken() } });
            removeToken();
            await checkAuth();
            fetchGallery();
            showToast('Uitgelogd!');
        }

        fileInput.addEventListener('change', () => {
            if (fileInput.files[0]) {
                fileNameDisplay.textContent = fileInput.files[0].name;
            }
        });

        function switchFeed(type) {
            currentFeedType = type;
            fetchGallery();
        }

        async function fetchGallery() {
            try {
                const res = await fetch('/api/gallery');
                allArtworks = await res.json();
                
                let filteredItems = allArtworks;
                if (currentFeedType === 'following') {
                    if (!currentLoggedInUser) {
                        showToast('Log in om je Volgt-feed te zien', 'error');
                        currentFeedType = 'fyp';
                        return;
                    }
                    // Haal eerst actuele user profiel op om following lijst te hebben
                    const userRes = await fetch(\`/api/user/\${currentLoggedInUser}\`);
                    const userData = await userRes.json();
                    const followingList = userData.following || [];
                    filteredItems = allArtworks.filter(art => followingList.includes(art.author) || art.author === currentLoggedInUser);
                }

                renderShortsFeed(filteredItems);
            } catch (err) {
                showToast('Fout bij laden van Feed', 'error');
            }
        }

        function renderShortsFeed(items) {
            shortsFeed.innerHTML = '';

            if (items.length === 0) {
                shortsFeed.innerHTML = \`
                    <div class="h-full flex flex-col items-center justify-center text-center p-4">
                        <i class="fa-solid fa-ghost text-6xl text-gray-600 mb-4"></i>
                        <p class="pixel-font text-yellow-400">Nog geen Shorts of MP4's gevonden!</p>
                    </div>
                \`;
                return;
            }

            items.forEach((art) => {
                const likes = art.likes || [];
                const comments = art.comments || [];
                const isLiked = currentLoggedInUser && likes.includes(currentLoggedInUser);
                const isOwner = currentLoggedInUser && art.author.toLowerCase() === currentLoggedInUser.toLowerCase();
                const isVideo = art.isVideo || art.url.endsWith('.mp4');
                const authorPfp = art.authorPfp || '/uploads/default-avatar.png';

                const itemSection = document.createElement('section');
                itemSection.className = 'shorts-item';
                
                const mediaElementHTML = isVideo ? \`
                    <video src="\${art.url}" class="pixel-media-full" id="media-\${art.id}" autoplay loop muted playsinline></video>
                \` : \`
                    <img src="\${art.url}" alt="\${art.title}" class="pixel-media-full" id="media-\${art.id}">
                \`;

                itemSection.innerHTML = \`
                    \${mediaElementHTML}

                    <!-- Floating Heart -->
                    <div id="heart-anim-\${art.id}" class="absolute hidden pointer-events-none text-red-500 text-8xl z-40">
                        <i class="fa-solid fa-heart"></i>
                    </div>

                    <!-- Sidebar Knoppen -->
                    <div class="absolute right-4 bottom-20 flex flex-col gap-5 items-center z-30">
                        <button onclick="toggleLike(\${art.id})" class="flex flex-col items-center group">
                            <div class="w-12 h-12 rounded-full bg-black/60 border-2 border-white flex items-center justify-center text-2xl \${isLiked ? 'text-red-500' : 'text-white'} group-hover:scale-110 transition">
                                <i class="fa-solid fa-heart"></i>
                            </div>
                            <span class="text-xs font-bold mt-1 text-white">\${likes.length}</span>
                        </button>

                        <button onclick="openComments(\${art.id})" class="flex flex-col items-center group">
                            <div class="w-12 h-12 rounded-full bg-black/60 border-2 border-white flex items-center justify-center text-xl text-white group-hover:scale-110 transition">
                                <i class="fa-solid fa-comment"></i>
                            </div>
                            <span class="text-xs font-bold mt-1 text-white">\${comments.length}</span>
                        </button>

                        \${isVideo ? \`
                            <button onclick="toggleMute(\${art.id})" class="flex flex-col items-center group">
                                <div id="mute-btn-\${art.id}" class="w-12 h-12 rounded-full bg-black/60 border-2 border-white flex items-center justify-center text-xl text-yellow-400 group-hover:scale-110 transition">
                                    <i class="fa-solid fa-volume-xmark"></i>
                                </div>
                                <span class="text-xs font-bold mt-1 text-white">Audio</span>
                            </button>
                        \` : ''}

                        <button onclick="shareArt('\${art.title}')" class="flex flex-col items-center group">
                            <div class="w-12 h-12 rounded-full bg-black/60 border-2 border-white flex items-center justify-center text-xl text-white group-hover:scale-110 transition">
                                <i class="fa-solid fa-share-nodes"></i>
                            </div>
                            <span class="text-xs font-bold mt-1 text-white">Share</span>
                        </button>

                        \${isOwner ? \`
                            <button onclick="deleteArt(\${art.id})" class="flex flex-col items-center group">
                                <div class="w-12 h-12 rounded-full bg-black/60 border-2 border-red-500 flex items-center justify-center text-xl text-red-500 group-hover:scale-110 transition">
                                    <i class="fa-solid fa-trash"></i>
                                </div>
                                <span class="text-xs font-bold mt-1 text-red-500">Wis</span>
                            </button>
                        \` : ''}
                    </div>

                    <!-- Info Overlay Bottom Left (Klikbaar naar profiel) -->
                    <div class="absolute left-4 bottom-6 right-20 z-30 bg-gradient-to-t from-black/80 to-transparent p-4 rounded-xl cursor-pointer" onclick="openUserProfile('\${art.author}')">
                        <div class="flex items-center gap-2 mb-2">
                            <img src="\${authorPfp}" class="w-9 h-9 rounded-full border-2 border-yellow-400 object-cover" alt="Avatar">
                            <span class="font-bold text-yellow-300 underline">@\${art.author}</span>
                            \${isVideo ? '<span class="text-[10px] bg-red-600 px-1 rounded font-bold">VIDEO</span>' : ''}
                        </div>
                        <h3 class="pixel-font text-white text-xs mb-1 truncate">\${art.title}</h3>
                    </div>
                \`;

                shortsFeed.appendChild(itemSection);

                const mediaEl = itemSection.querySelector(\`#media-\${art.id}\`);
                let lastClick = 0;
                mediaEl.addEventListener('click', () => {
                    const now = new Date().getTime();
                    if (now - lastClick < 300) {
                        triggerDoubleTapLike(art.id);
                    }
                    lastClick = now;
                });
            });
        }

        // --- PROFIEL & FOLLOW LOGICA ---
        async function openUserProfile(username) {
            try {
                const res = await fetch(\`/api/user/\${username}\`);
                const data = await res.json();
                if (!res.ok) {
                    showToast(data.error || 'Kon profiel niet laden', 'error');
                    return;
                }

                document.getElementById('profile-avatar').src = data.profilePic || '/uploads/default-avatar.png';
                document.getElementById('profile-username').textContent = '@' + data.username;
                document.getElementById('profile-bio').textContent = data.bio || 'Geen bio opgegeven.';
                document.getElementById('profile-following-count').textContent = data.followingCount;
                document.getElementById('profile-followers-count').textContent = data.followersCount;

                const actionContainer = document.getElementById('profile-action-container');
                actionContainer.innerHTML = '';

                if (currentLoggedInUser) {
                    if (currentLoggedInUser.toLowerCase() === data.username.toLowerCase()) {
                        actionContainer.innerHTML = \`<button onclick="closeModal('profile-modal'); openSettings();" class="retro-btn text-xs bg-yellow-400">Bewerk Profiel</button>\`;
                    } else {
                        // Check of we volgen
                        const meRes = await fetch(\`/api/user/\${currentLoggedInUser}\`);
                        const meData = await meRes.json();
                        const isFollowing = meData.following && meData.following.includes(data.username);

                        actionContainer.innerHTML = \`
                            <button onclick="toggleFollow('\${data.username}')" id="follow-btn" class="retro-btn text-xs \${isFollowing ? 'bg-gray-600 text-white' : 'bg-yellow-400 text-black'}">
                                \${isFollowing ? 'Volgend ✓' : '+ Volg'}
                            </button>
                        \`;
                    }
                }

                // Render grid met posts van deze gebruiker
                const grid = document.getElementById('profile-grid');
                grid.innerHTML = '';
                if (data.artworks && data.artworks.length > 0) {
                    data.artworks.forEach(art => {
                        const cell = document.createElement('div');
                        cell.className = 'aspect-square bg-black border-2 border-black overflow-hidden relative cursor-pointer';
                        cell.innerHTML = art.isVideo ? \`
                            <video src="\${art.url}" class="w-full h-full object-cover"></video>
                            <div class="absolute bottom-1 right-1 bg-black/70 px-1 text-[10px]"><i class="fa-solid fa-video"></i></div>
                        \` : \`
                            <img src="\${art.url}" class="w-full h-full object-cover">
                        \`;
                        grid.appendChild(cell);
                    });
                } else {
                    grid.innerHTML = '<p class="col-span-3 text-xs text-gray-400 text-center py-4">Nog geen uploads.</p>';
                }

                openModal('profile-modal');
            } catch (err) {
                showToast('Fout bij openen profiel', 'error');
            }
        }

        function openMyProfile() {
            if (!currentLoggedInUser) {
                showToast('Log in om je profiel te bekijken', 'error');
                toggleAuthModal('login');
                return;
            }
            openUserProfile(currentLoggedInUser);
        }

        async function toggleFollow(targetUsername) {
            const token = getToken();
            if (!token) return;

            try {
                const res = await fetch(\`/api/user/\${targetUsername}/follow\`, {
                    method: 'POST',
                    headers: { 'Authorization': token }
                });
                const data = await res.json();
                if (res.ok) {
                    playRetroSound(700, 0.1);
                    const btn = document.getElementById('follow-btn');
                    const followersCountEl = document.getElementById('profile-followers-count');
                    followersCountEl.textContent = data.followersCount;

                    if (data.isFollowing) {
                        btn.className = 'retro-btn text-xs bg-gray-600 text-white';
                        btn.textContent = 'Volgend ✓';
                    } else {
                        btn.className = 'retro-btn text-xs bg-yellow-400 text-black';
                        btn.textContent = '+ Volg';
                    }
                } else {
                    showToast(data.error || 'Volgen mislukt', 'error');
                }
            } catch (err) {
                showToast('Fout bij volgen', 'error');
            }
        }

        function openSettings() {
            if (!currentLoggedInUser) {
                showToast('Log in om instellingen te openen', 'error');
                toggleAuthModal('login');
                return;
            }
            // Haal huidige bio op
            fetch(\`/api/user/\${currentLoggedInUser}\`)
                .then(res => res.json())
                .then(data => {
                    document.getElementById('settings-bio-input').value = data.bio || '';
                    openModal('settings-modal');
                });
        }

        document.getElementById('settings-form').addEventListener('submit', async (e) => {
            e.preventDefault();
            const token = getToken();
            if (!token) return;

            const bio = document.getElementById('settings-bio-input').value;
            const pfpFile = document.getElementById('settings-pfp-input').files[0];

            const formData = new FormData();
            formData.append('bio', bio);
            if (pfpFile) formData.append('profilePic', pfpFile);

            try {
                const res = await fetch('/api/profile/update', {
                    method: 'POST',
                    headers: { 'Authorization': token },
                    body: formData
                });

                if (res.ok) {
                    showToast('Profiel opgeslagen!');
                    closeModal('settings-modal');
                    await checkAuth();
                    fetchGallery();
                } else {
                    showToast('Opslaan mislukt', 'error');
                }
            } catch (err) {
                showToast('Serverfout bij opslaan', 'error');
            }
        });

        function toggleMute(artId) {
            const videoEl = document.getElementById(\`media-\${artId}\`);
            const btnEl = document.getElementById(\`mute-btn-\${artId}\`);
            if (videoEl && videoEl.tagName === 'VIDEO') {
                videoEl.muted = !videoEl.muted;
                if (videoEl.muted) {
                    btnEl.innerHTML = '<i class="fa-solid fa-volume-xmark"></i>';
                } else {
                    btnEl.innerHTML = '<i class="fa-solid fa-volume-high text-green-400"></i>';
                }
            }
        }

        async function triggerDoubleTapLike(artId) {
            const animEl = document.getElementById(\`heart-anim-\${artId}\`);
            if (animEl) {
                animEl.classList.remove('hidden', 'heart-pop');
                void animEl.offsetWidth;
                animEl.classList.add('heart-pop');
                setTimeout(() => animEl.classList.add('hidden'), 800);
            }
            playRetroSound(880, 0.15);
            await toggleLike(artId);
        }

        async function toggleLike(artId) {
            const token = getToken();
            if (!token) {
                showToast('Log in om te liken!', 'error');
                toggleAuthModal('login');
                return;
            }

            try {
                const res = await fetch(\`/api/art/\${artId}/like\`, {
                    method: 'POST',
                    headers: { 'Authorization': token }
                });

                if (res.ok) {
                    playRetroSound(600, 0.08);
                    await fetchGallery();
                } else {
                    const data = await res.json();
                    showToast(data.error || 'Liken mislukt', 'error');
                }
            } catch (err) {
                showToast('Fout bij liken', 'error');
            }
        }

        function shareArt(title) {
            if (navigator.clipboard) {
                navigator.clipboard.writeText(window.location.href);
                showToast('Link gekopieerd!');
                playRetroSound(1000, 0.1);
            }
        }

        function openComments(artId) {
            activeArtIdForComments = artId;
            const art = allArtworks.find(a => a.id === artId);
            const commentsList = document.getElementById('comments-list');
            commentsList.innerHTML = '';

            if (art && art.comments && art.comments.length > 0) {
                art.comments.forEach(c => {
                    const div = document.createElement('div');
                    div.className = 'p-2 bg-gray-800 border-2 border-black rounded flex items-start gap-2';
                    div.innerHTML = \`
                        <img src="\${c.authorPfp || '/uploads/default-avatar.png'}" class="w-7 h-7 rounded-full object-cover border border-yellow-400">
                        <div>
                            <div class="text-xs text-yellow-300 font-bold">@\${c.author}</div>
                            <div class="text-sm text-gray-200">\${c.text}</div>
                        </div>
                    \`;
                    commentsList.appendChild(div);
                });
            } else {
                commentsList.innerHTML = '<p class="text-xs text-gray-400 text-center py-4">Nog geen reacties. Wees de eerste!</p>';
            }

            openModal('comments-modal');
        }

        document.getElementById('comment-form').addEventListener('submit', async (e) => {
            e.preventDefault();
            const token = getToken();
            if (!token) {
                showToast('Log in om te reageren!', 'error');
                toggleAuthModal('login');
                return;
            }

            const input = document.getElementById('comment-input');
            const text = input.value;
            if (!text.trim() || !activeArtIdForComments) return;

            try {
                const res = await fetch(\`/api/art/\${activeArtIdForComments}/comment\`, {
                    method: 'POST',
                    headers: { 
                        'Content-Type': 'application/json',
                        'Authorization': token 
                    },
                    body: JSON.stringify({ text })
                });

                if (res.ok) {
                    input.value = '';
                    playRetroSound(750, 0.1);
                    await fetchGallery();
                    openComments(activeArtIdForComments);
                } else {
                    const data = await res.json();
                    showToast(data.error || 'Reactie mislukt', 'error');
                }
            } catch (err) {
                showToast('Fout bij reageren', 'error');
            }
        });

        async function deleteArt(artId) {
            if (!confirm('Kunstwerk verwijderen?')) return;

            const token = getToken();
            try {
                const res = await fetch(\`/api/art/\${artId}\`, {
                    method: 'DELETE',
                    headers: { 'Authorization': token }
                });

                if (res.ok) {
                    showToast('Verwijderd!');
                    fetchGallery();
                } else {
                    const data = await res.json();
                    showToast(data.error || 'Mislukt', 'error');
                }
            } catch (err) {
                showToast('Fout bij verwijderen', 'error');
            }
        }

        document.getElementById('upload-form').addEventListener('submit', (e) => {
            e.preventDefault();

            const token = getToken();
            if (!token) {
                showToast('Log in om te uploaden!', 'error');
                toggleAuthModal('login');
                return;
            }

            const title = document.getElementById('art-title').value;
            const file = fileInput.files[0];
            if (!file) return;

            const formData = new FormData();
            formData.append('title', title);
            formData.append('pixelart', file);

            const submitBtn = document.getElementById('upload-submit-btn');
            const progressContainer = document.getElementById('progress-container');
            const progressBar = document.getElementById('progress-bar');
            const progressText = document.getElementById('progress-text');

            submitBtn.disabled = true;
            submitBtn.textContent = 'Bezig...';
            progressContainer.classList.remove('hidden');
            progressBar.style.width = '0%';
            progressText.textContent = '0%';

            const xhr = new XMLHttpRequest();
            xhr.open('POST', '/api/upload', true);
            xhr.setRequestHeader('Authorization', token);

            xhr.upload.onprogress = (event) => {
                if (event.lengthComputable) {
                    const percentComplete = Math.round((event.loaded / event.total) * 100);
                    progressBar.style.width = percentComplete + '%';
                    progressText.textContent = percentComplete + '%';
                }
            };

            xhr.onload = () => {
                submitBtn.disabled = false;
                submitBtn.textContent = 'Publiceren';
                progressContainer.classList.add('hidden');

                if (xhr.status >= 200 && xhr.status < 300) {
                    showToast('Media geüpload!');
                    document.getElementById('upload-form').reset();
                    fileNameDisplay.textContent = 'Kies .png, .jpg of .mp4';
                    closeModal('upload-modal');
                    fetchGallery();
                } else {
                    try {
                        const data = JSON.parse(xhr.responseText);
                        showToast(data.error || 'Upload mislukt', 'error');
                    } catch (err) {
                        showToast('Upload mislukt', 'error');
                    }
                }
            };

            xhr.onerror = () => {
                submitBtn.disabled = false;
                submitBtn.textContent = 'Publiceren';
                progressContainer.classList.add('hidden');
                showToast('Verbindingsfout bij uploaden', 'error');
            };

            xhr.send(formData);
        });

        window.addEventListener('keydown', (e) => {
            if (e.key === 'ArrowDown') {
                shortsFeed.scrollBy({ top: window.innerHeight - 65, behavior: 'smooth' });
            } else if (e.key === 'ArrowUp') {
                shortsFeed.scrollBy({ top: -(window.innerHeight - 65), behavior: 'smooth' });
            }
        });

        checkAuth().then(() => fetchGallery());
    </script>
</body>
</html>
  `);
});

app.listen(PORT, async () => {
  console.log(`🚀 Pixel Art & Video Server gestart op http://localhost:${PORT}`);
  if (ngrok) {
    try {
      const listener = await ngrok.forward({ addr: PORT, authtoken: NGROK_AUTHTOKEN });
      console.log(`🌐 Ngrok live URL: 👉 ${listener.url()}`);
    } catch (error) {
      console.error('❌ Ngrok fout:', error.message);
    }
  }
});