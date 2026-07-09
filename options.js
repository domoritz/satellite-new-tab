// Saves options to storage.
function saveOptions() {
  const query = {
    imageType: document.getElementById("image").value,
    animated: document.getElementById("animated").checked
  };

  function callback() {
    // Update status to let user know options were saved.
    const status = document.getElementById("status");
    status.textContent = "Options saved.";
    setTimeout(() => {
      status.textContent = "";
    }, 2000);
  }

  browser.storage.sync.set(query).then(callback);
}

// Restores select box and checkbox state using the preferences
// stored in chrome.storage.
function restoreOptions() {
  const query = { imageType: "HIMAWARI_9", animated: false };

  function callback(options) {
    document.getElementById("image").value = options.imageType;
    document.getElementById("animated").checked = options.animated;
  }

  browser.storage.sync.get(query).then(callback);
}

document.addEventListener("DOMContentLoaded", restoreOptions);
document.getElementById("save").addEventListener("click", saveOptions);

document.getElementById("year").innerText = new Date().getFullYear();
