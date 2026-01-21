import { db } from "./firebase.js";
import { ref, set, onValue, update, remove } 
from "https://www.gstatic.com/firebasejs/12.8.0/firebase-database.js";

const boardEl = document.getElementById("board");
const info = document.getElementById("info");
const roleInfo = document.getElementById("roleInfo");
const resetBtn = document.getElementById("resetBtn");

let room = null;
let role = null; // X | O | spectator
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

/* ===== JOIN AS PLAYER ===== */
document.getElementById("joinPlayerBtn").onclick = () => {
  joinRoom("player");
};

/* ===== JOIN AS SPECTATOR ===== */
document.getElementById("joinSpectatorBtn").onclick = () => {
  joinRoom("spectator");
};

/* ===== JOIN ROOM ===== */
function joinRoom(mode) {
  room = document.getElementById("roomInput").value;
  if (!room) return alert("Isi nama room!");

  document.getElementById("lobby").style.display = "none";

  const roomRef = ref(db, `rooms/${room}`);

  onValue(roomRef, snap => {
    if (!snap.exists()) {
      if (mode === "spectator") {
        set(roomRef, {
          board: Array(9).fill(""),
          turn: "X",
          players: {},
          spectators: { [playerId]: true }
        });
        role = "spectator";
      } else {
        set(roomRef, {
          board: Array(9).fill(""),
          turn: "X",
          players: { X: playerId },
          spectators: {}
        });
        role = "X";
      }
    } else {
      const data = snap.val();

      if (mode === "spectator") {
        role = "spectator";
        update(roomRef, {
          [`spectators/${playerId}`]: true
        });
      } else {
        if (!data.players?.X) {
          role = "X";
          update(roomRef, { "players/X": playerId });
        } else if (!data.players?.O) {
          role = "O";
          update(roomRef, { "players/O": playerId });
        } else {
          alert("Slot player penuh! Join sebagai spectator.");
          role = "spectator";
          update(roomRef, {
            [`spectators/${playerId}`]: true
          });
        }
      }
    }
  }, { onlyOnce: true });

  listenRoom();
}

/* ===== LISTENER ===== */
function listenRoom() {
  onValue(ref(db, `rooms/${room}`), snap => {
    const data = snap.val();
    if (!data) return;

    data.board.forEach((v, i) => {
      cells[i].innerText = v;
      cells[i].classList.toggle(
        "clickable",
        role !== "spectator" && data.turn === role && v === ""
      );
    });

    if (role === "spectator") {
      info.innerText = `👀 Kamu Spectator | Giliran: ${data.turn}`;
      roleInfo.innerText = "Mode: Spectator (tidak bisa bermain)";
    } else {
      info.innerText = `🎮 Kamu Player ${role} | Giliran: ${data.turn}`;
      roleInfo.innerText = "Mode: Player";
    }

    const win = checkWin(data.board);
    if (win) {
      info.innerText = `🏆 Pemenang: ${win}`;
      resetBtn.style.display = role === "spectator" ? "none" : "inline";
    } else if (!data.board.includes("")) {
      info.innerText = "🤝 Seri!";
      resetBtn.style.display = role === "spectator" ? "none" : "inline";
    }
  });
}

/* ===== MOVE ===== */
function makeMove(i) {
  if (role === "spectator") return;

  const roomRef = ref(db, `rooms/${room}`);
  onValue(roomRef, snap => {
    const data = snap.val();
    if (!data) return;
    if (data.turn !== role) return;
    if (data.board[i] !== "") return;

    data.board[i] = role;
    data.turn = role === "X" ? "O" : "X";

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
  if (!room) return;
  if (role === "spectator") {
    remove(ref(db, `rooms/${room}/spectators/${playerId}`));
  } else {
    remove(ref(db, `rooms/${room}/players/${role}`));
  }
});
