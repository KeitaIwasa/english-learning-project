chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: "add-to-flashcards",
    title: "Add to English Flashcards",
    contexts: ["selection"]
  });
});

chrome.contextMenus.onClicked.addListener(async (info) => {
  if (info.menuItemId !== "add-to-flashcards") {
    return;
  }

  const text = (info.selectionText || "").trim();
  if (!text) {
    return;
  }

  await chrome.storage.local.set({ selectedEnglish: text });
});
