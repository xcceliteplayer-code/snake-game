import { db } from "./firebase.js";
import { ref, set, onValue, update, remove } 
from "https://www.gstatic.com/firebasejs/12.8.0/firebase-database.js";

const boardEl = document.getElementById("board");
const info = document.getElementById("info");
const resetBtn = document.getElementById("resetBtn");

let room = null;
let symbol = null;
const playerId = "p" + Math.floor(Math.random() * 99999);

/* ===== CREATE BOARD ===== */
const cells = [];
for (let i = 0; i < 9; i++) {
  const div = document.createElement("div");
  div.className = "cell";
  div.onclick = () => makeMove(i);
  boardEl.appendChild(div);
  cells.push(div);
}

/* ===== JOIN ROOM ===== */
document.getElementById("joinBtn").onclick = () => {
  room = document.getElementById("roomInput").value;
  if (!room) return alert("Isi nama room!");

  document.getElementById("lobby").style.display = "none";

  const roomRef = ref(db, `rooms/${room}`);

  onValue(roomRef, snap => {
    if (!snap.exists()) {
      set(roomRef, {
        board: Array(9).fill(""),
        turn: "X",
        players: { [playerId]: "X" }
      });
      symbol = "X";
    } else {
      const data = snap.val();
      const players = data.players || {};
      if (Object.keys(players).length >= 2) {
        alert("Room penuh!");
        location.reload();
      }
      symbol = "O";
      update(roomRef, {
        [`players/${playerId}`]: "O"
      });
    }
  }, { onlyOnce: true });

  listenRoom();
};

/* ===== LISTENER ===== */
function listenRoom() {
  onValue(ref(db, `rooms/${room}`), snap => {
    const data = snap.val();
    if (!data) return;

    data.board.forEach((v, i) => {
      cells[i].innerText = v;
    });

    const win = checkWin(data.board);
    if (win) {
      info.innerText = "Pemenang: " + win;
      resetBtn.style.display = "inline";
    } else if (!data.board.includes("")) {
      info.innerText = "Seri!";
      resetBtn.style.display = "inline";
    } else {
      info.innerText = `Giliran: ${data.turn}`;
    }
  });
}

/* ===== MOVE ===== */
function makeMove(i) {
  const roomRef = ref(db, `rooms/${room}`);
  onValue(roomRef, snap => {
    const data = snap.val();
    if (!data) return;
    if (data.turn !== symbol) return;
    if (data.board[i] !== "") return;

    data.board[i] = symbol;
    data.turn = symbol === "X" ? "O" : "X";

    update(roomRef, {
      board: data.board,
      turn: data.turn
    });
  }, { onlyOnce: true });
}

/* ===== RESET ===== */
resetBtn.onclick = () => {
  set(ref(db, `rooms/${room}/board`), Array(9).fill(""));
  set(ref(db, `rooms/${room}/turn`), "X");
  resetBtn.style.display = "none";
};

/* ===== CHECK WIN ===== */
function checkWin(b) {
  const w = [
    [0,1,2],[3,4,5],[6,7,8],
    [0,3,6],[1,4,7],[2,5,8],
    [0,4,8],[2,4,6]
  ];
  for (const [a,b1,c] of w) {
    if (b[a] && b[a] === b[b1] && b[a] === b[c]) {
      return b[a];
    }
  }
  return null;
}

/* ===== CLEANUP ===== */
window.addEventListener("beforeunload", () => {
  if (room) remove(ref(db, `rooms/${room}/players/${playerId}`));
});
