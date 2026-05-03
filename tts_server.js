require('dotenv').config();
const express = require('express');
const axios = require('axios');
const cors = require('cors');

const app = express();

// Middleware
app.use(cors());
app.use(express.json({ limit: '10mb' }));

// Конфигурация API-ключей
const config = {
  elevenLabs: {
    apiKey: process.env.ELEVENLABS_API_KEY || 'YOUR_ELEVENLABS_API_KEY_HERE',
    voiceId: 'EXAVITQu4vr4xnSDxMaL' // Rachel voice - одна из лучших для аудиокниг
  },
  googleCloud: {
    apiKey: process.env.GOOGLE_TTS_API_KEY || 'YOUR_GOOGLE_TTS_API_KEY_HERE'
  },
  yandex: {
    apiKey: process.env.YANDEX_API_KEY || 'YOUR_YANDEX_API_KEY_HERE',
    folderId: process.env.YANDEX_FOLDER_ID || 'YOUR_YANDEX_FOLDER_ID_HERE'
  }
};

// Кеш для аудио файлов (в реальном приложении лучше использовать Redis или базу данных)
const audioCache = new Map();

/**
 * Генерация речи с использованием ElevenLabs
 * Это лучший выбор для аудиокниг - читает длинные тексты, 
 * звучит как живой диктор, поддерживает интонации и эмоции
 */
async function generateWithElevenLabs(text, language, options = {}) {
  const { rate = 1.0, pitch = 1.0, volume = 1.0 } = options;
  
  const url = `https://api.elevenlabs.io/v1/text-to-speech/${config.elevenLabs.voiceId}/stream`;
  
  const response = await axios.post(url, {
    text: text,
    model_id: "eleven_multilingual_v2", // Поддерживает русский, английский и другие языки
    voice_settings: {
      stability: 0.5,
      similarity_boost: 0.75
    }
  }, {
    headers: {
      'xi-api-key': config.elevenLabs.apiKey,
      'Content-Type': 'application/json'
    },
    responseType: 'stream'
  });
  
  return response.data; // stream
}

/**
 * Генерация речи с использованием Google Cloud Text-to-Speech
 */
async function generateWithGoogleTTS(text, language, options = {}) {
  const { rate = 1.0, pitch = 1.0, volume = 1.0 } = options;
  
  const url = `https://texttospeech.googleapis.com/v1/text:synthesize?key=${config.googleCloud.apiKey}`;
  
  // Для казахского языка используем специфический код
  let languageCode = language;
  if (language.startsWith('kk') || language.startsWith('kz')) {
    languageCode = 'kk-KZ'; // Казахский (Казахстан) - наиболее распространенный вариант
  }
  
  const requestBody = {
    input: {
      text: text
    },
    voice: {
      languageCode: languageCode,
      ssmlGender: 'NEUTRAL'
    },
    audioConfig: {
      audioEncoding: 'MP3',
      speakingRate: rate,
      pitch: pitch,
      volumeGainDb: volume * 10 // преобразуем в децибелы
    }
  };
  
  const response = await axios.post(url, requestBody, {
    headers: {
      'Content-Type': 'application/json'
    }
  });
  
  // Возвращаем аудио данные из ответа
  const audioContent = response.data.audioContent;
  return Buffer.from(audioContent, 'base64');
}

/**
 * Генерация речи с использованием Yandex SpeechKit
 */
async function generateWithYandexTTS(text, language, options = {}) {
  const { rate = 1.0 } = options;

  const isKazakh = language.startsWith('kk');
  const lang = isKazakh ? 'kk-KZ' : 'ru-RU';

  const params = new URLSearchParams({
    text,
    lang,
    voice: isKazakh ? 'aidar' : 'ermil',
    speed: rate.toString(),
    folderId: config.yandex.folderId,
    format: 'mp3'
  });

  try {
    const response = await axios.post(
      'https://tts.api.cloud.yandex.net/speech/v1/tts:synthesize',
      params.toString(),
      {
        headers: {
          Authorization: `Api-Key ${config.yandex.apiKey}`,
          'Content-Type': 'application/x-www-form-urlencoded'
        },
        responseType: 'arraybuffer'
      }
    );

    return Buffer.from(response.data);
  } catch (e) {
    console.error('YANDEX TTS ERROR:', e.response?.data || e.message);
    throw e;
  }
}

/**
 * Определение лучшего сервиса для языка
 * ElevenLabs - лучший выбор для аудиокниг (русский, английский)
 * Yandex - для казахского (лучше всего читает казахский)
 */
function getBestTTSService(language) {
  // Для русского и английского используем ElevenLabs (лучшее качество для аудиокниг)
  if (language.startsWith('ru') || language.startsWith('en')) {
    return 'elevenlabs';
  }
  // Для казахского используем Yandex (лучше всего читает казахский)
  else if (language.startsWith('kk') || language.startsWith('kz')) {
    return 'yandex';
  }
  // По умолчанию используем ElevenLabs
  return 'elevenlabs';
}

/**
 * API endpoint для генерации TTS
 */
app.post('/api/tts', async (req, res) => {
  try {
    const { text, language, rate = 1.0, pitch = 1.0, volume = 1.0 } = req.body;

    if (!text) {
      return res.status(400).json({ error: 'Text is required' });
    }

    // Создаем ключ для кеширования
    const cacheKey = `${text}_${language}_${rate}_${pitch}_${volume}`;
    
    // Проверяем, есть ли аудио в кеше
    if (audioCache.has(cacheKey)) {
      console.log('Returning cached audio');
      const cachedAudio = audioCache.get(cacheKey);
      res.set('Content-Type', 'audio/mpeg');
      res.set('Cache-Control', 'public, max-age=3600');
      return res.send(cachedAudio);
    }

    console.log(`Generating TTS for language: ${language}, text length: ${text.length}`);
    
    // Добавим логирование для диагностики
    console.log('Request details:', {
      language,
      rate,
      pitch,
      volume,
      textLength: text.length
    });
    
    const ttsService = getBestTTSService(language);
    console.log('Selected TTS service:', ttsService);
    
    let audioStream;
    
    if (ttsService === 'elevenlabs') {
      console.log('Using ElevenLabs for TTS (best for audiobooks)');
      // Проверяем, установлен ли API-ключ
      if (config.elevenLabs.apiKey === 'YOUR_ELEVENLABS_API_KEY_HERE') {
        return res.status(500).json({ error: 'ElevenLabs API key not configured. Please set ELEVENLABS_API_KEY environment variable.' });
      }
      audioStream = await generateWithElevenLabs(text, language, { rate, pitch, volume });
    } else if (ttsService === 'yandex') {
      console.log('Using Yandex SpeechKit for Kazakh TTS');
      // Проверяем, установлены ли API-ключ и folderId
      if (config.yandex.apiKey === 'YOUR_YANDEX_API_KEY_HERE') {
        return res.status(500).json({ error: 'Yandex API key not configured. Please set YANDEX_API_KEY environment variable.' });
      }
      if (config.yandex.folderId === 'YOUR_YANDEX_FOLDER_ID_HERE') {
        return res.status(500).json({ error: 'Yandex folder ID not configured. Please set YANDEX_FOLDER_ID environment variable.' });
      }
      audioStream = await generateWithYandexTTS(text, language, { rate, pitch, volume });
    } else {
      return res.status(500).json({ error: 'Unsupported TTS service' });
    }

    // Устанавливаем заголовки для аудио
    res.set('Content-Type', 'audio/mpeg');
    res.set('Cache-Control', 'public, max-age=3600'); // Кешируем на 1 час
    
    // Если это stream (ElevenLabs), передаем его напрямую
    if (audioStream && typeof audioStream.pipe === 'function') {
      audioStream.pipe(res);
      
      // Кешируем результат после завершения передачи
      const chunks = [];
      audioStream.on('data', chunk => chunks.push(chunk));
      audioStream.on('end', () => {
        const buffer = Buffer.concat(chunks);
        audioCache.set(cacheKey, buffer);
        
        // Ограничиваем размер кеша (удаляем старые записи, если кеш слишком большой)
        if (audioCache.size > 100) {
          const firstKey = audioCache.keys().next().value;
          audioCache.delete(firstKey);
        }
      });
    } else {
      // Если это Buffer (Google), отправляем сразу
      res.send(audioStream);
      
      // Кешируем результат
      audioCache.set(cacheKey, audioStream);
      
      // Ограничиваем размер кеша
      if (audioCache.size > 100) {
        const firstKey = audioCache.keys().next().value;
        audioCache.delete(firstKey);
      }
    }
  } catch (error) {
    console.error('TTS Error:', error);

    // Возвращаем более безопасное сообщение об ошибке
    res.status(500).json({ 
      error: 'TTS Service Error',
      message: error.message || 'Unknown error'
    });
  }
});

// Запуск сервера
const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  console.log(`TTS API available at http://localhost:${PORT}/api/tts`);
});