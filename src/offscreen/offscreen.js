import { logger } from '../utils/logger.js';
/**
 * Offscreen document for audio playback and voice synthesis
 * Chrome requires audio to be played from a document context
 */

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'PLAY_SOUND') {
    playAlert();
    sendResponse({ played: true });
  }
  if (message.type === 'SPEAK_REMINDER') {
    speakReminder(message.text);
    sendResponse({ spoken: true });
  }
  return true;
});

async function playAlert() {
  try {
    const audio = new Audio(chrome.runtime.getURL('assets/sounds/sweep.mp3'));
    audio.volume = 0.7;
    await audio.play();
    logger.debug('Alert sound played');
  } catch (error) {
    logger.error('Error playing sound', error);
  }
}

function speakReminder(text) {
  try {
    // Cancel any ongoing speech
    window.speechSynthesis.cancel();

    const utterance = new SpeechSynthesisUtterance(text);
    utterance.rate = 1.0;
    utterance.pitch = 1.0;
    utterance.volume = 1.0;
    utterance.lang = 'en-US';

    window.speechSynthesis.speak(utterance);
    logger.debug('Voice reminder spoken:', text);
  } catch (error) {
    logger.error('Error speaking reminder', error);
  }
}
