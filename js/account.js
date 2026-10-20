// The account bar: sign in, sign out, and the first-time username screen.
import {

  watchUser,
  signInWithGoogle,
  signOutUser,
  getProfile,
  createProfile,
  USERNAME_RULE,
} from "./auth.js";
import { startFriends, stopFriends } from "./friends.js";
import { startStats, stopStats } from "./stats.js";
import { startGroups, stopGroups } from "./groups.js";
stopStats();
stopGroups();
usernameOverlay.hidden = true;

// Other files can read who is signed in from here (used by friends/groups later).
export const me = { user: null, profile: null };

export function initAccount(ui) {
  const signInBtn = document.getElementById("signInBtn");
  const signOutBtn = document.getElementById("signOutBtn");
  const accountUser = document.getElementById("accountUser");
  const accountPhoto = document.getElementById("accountPhoto");
  const accountName = document.getElementById("accountName");
  const usernameOverlay = document.getElementById("usernameOverlay");
  const usernameInput = document.getElementById("usernameInput");
  const usernameError = document.getElementById("usernameError");
  const usernameSaveBtn = document.getElementById("usernameSaveBtn");

  function showAccount() {
    signInBtn.hidden = !!me.user;
    accountUser.hidden = !me.user;
    if (!me.user) {
      accountName.textContent = "";
      accountPhoto.hidden = true;
      return;
    }

    accountName.textContent = me.profile ? "@" + me.profile.username : "Choose a username";
    const photo = (me.profile && me.profile.photoURL) || me.user.photoURL;
    accountPhoto.hidden = !photo;
    if (photo) accountPhoto.src = photo;
  }

  watchUser(async (user) => {
    me.user = user;
    me.profile = null;
    stopFriends();
    stopStats();
    stopGroups();
    usernameOverlay.hidden = true;
    showAccount();
    if (!user) return;

    try {
      me.profile = await getProfile(user.uid);
    } catch (err) {
      console.error(err);
      ui.showAlert("Could not load your profile. Check your connection.");
      return;
    }
    if (!me.profile) usernameOverlay.hidden = false; // first time: pick a username
    else {
      startFriends(me);
      startStats(me);
      startGroups(me);
    }
    showAccount();
  });

  signInBtn.addEventListener("click", async () => {
    try {
      await signInWithGoogle();
    } catch (err) {
      if (err.code !== "auth/popup-closed-by-user") {
        console.error(err);
        ui.showAlert("Sign-in failed: " + (err.code || err.message));
      }
    }
  });

  signOutBtn.addEventListener("click", () => signOutUser());

  usernameSaveBtn.addEventListener("click", async () => {
    usernameError.textContent = "";
    const wanted = usernameInput.value.trim().toLowerCase();
    if (!USERNAME_RULE.test(wanted)) {
      usernameError.textContent = "3-16 characters: letters, numbers and _ only";
      return;
    }

    usernameSaveBtn.disabled = true;
    try {
      me.profile = await createProfile(me.user, wanted);
      usernameOverlay.hidden = true;
      showAccount();
      startFriends(me);
      startStats(me);
      startGroups(me);
    } catch (err) {
      console.error(err);
      usernameError.textContent =
        err.message === "taken" ? "That username is taken" : "Could not save. Try again.";
    } finally {
      usernameSaveBtn.disabled = false;
    }
  });
}