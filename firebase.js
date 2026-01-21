import { initializeApp } from "https://www.gstatic.com/firebasejs/12.8.0/firebase-app.js";
import { getDatabase } from "https://www.gstatic.com/firebasejs/12.8.0/firebase-database.js";

const firebaseConfig = {
  apiKey: "AIzaSyCLRvyfE_ZgG20sZuWVge2baOElVSluvKk",
  authDomain: "snake-game-6d2fe.firebaseapp.com",
  databaseURL: "https://snake-game-6d2fe-default-rtdb.asia-southeast1.firebasedatabase.app",
  projectId: "snake-game-6d2fe",
  messagingSenderId: "881486411840",
  appId: "1:881486411840:web:250ca2d50a9dfbf65007a5"
};

export const app = initializeApp(firebaseConfig);
export const db = getDatabase(app);
