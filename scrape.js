const extractTweets = (maxTweets = 100) => {
  const tweets = [];

  const makeAbsolute = (url) => {
    try {
      return new URL(url, location.origin).href;
    } catch {
      return null;
    }
  };

  const parseCount = (raw) => {
    if (!raw) return 0;
    
    let txt = raw.replace(/,/g, '').trim();
    
    if (/^[0-9]+$/.test(txt)) return Number(txt);
    if (/^[0-9]*\.?[0-9]+[Kk]$/.test(txt)) return Math.round(parseFloat(txt) * 1e3);
    if (/^[0-9]*\.?[0-9]+[Mm]$/.test(txt)) return Math.round(parseFloat(txt) * 1e6);
    
    return 0;
  };

  const grabNumberFromButton = (article, testId) => {
    const btn = article.querySelector(`[data-testid="${testId}"]`);
    if (!btn) return 0;
    
    const spanTxt = btn.querySelector('span span')?.textContent || '';
    return parseCount(spanTxt);
  };

  const extractTweet = (article) => {
    if (!article || !(article instanceof Element)) return null;

    const textContent = Array.from(article.querySelectorAll('[data-testid="tweetText"]'))
      .map((el) => el.innerText.trim())
      .join('\n') || null;

    let displayName = null,
        username = null;
    const userBlock = article.querySelector('[data-testid="User-Name"]');
    if (userBlock) {
      displayName = userBlock.querySelector('div[dir="ltr"] span')?.textContent.trim() || null;
      username = userBlock.querySelector('a[role="link"][tabindex="-1"] span')?.textContent.trim() || null;
    }

    const profilePhotoUrl = (() => {
      const img = article.querySelector('[data-testid^="UserAvatar-Container"] img');
      if (!img) return null;
      
      const url = makeAbsolute(img.src);
      // Skip placeholder URLs that don't contain actual image data
      if (!url || url === 'https://x.com' || url.includes('data:image/svg+xml')) {
        return null;
      }
      return url;
    })();

    const timestamp = article.querySelector('time')?.getAttribute('datetime') || null;

    // Extract tweet link
    const tweetLink = (() => {
      const timeElement = article.querySelector('time');
      if (!timeElement) return null;
      
      const linkElement = timeElement.closest('a');
      if (!linkElement) return null;
      
      const href = linkElement.getAttribute('href');
      if (!href) return null;
      
      return makeAbsolute(href);
    })();

    // Detect if this is an ad
    const isAd = (() => {
      // Check for "Ad" text in the tweet - look more specifically
      const allSpans = article.querySelectorAll('span');
      for (const span of allSpans) {
        if (span.textContent?.trim() === 'Ad') {
          return true;
        }
      }
      
      // Check for ad-related elements
      const adElements = article.querySelectorAll('[data-testid*="placementTracking"], [data-testid*="impression"]');
      if (adElements.length > 0) return true;
      
      return false;
    })();

    const numberOfReplies = grabNumberFromButton(article, 'reply');
    const numberOfRetweets = grabNumberFromButton(article, 'retweet');
    const numberOfLikes = grabNumberFromButton(article, 'like');
    const numberOfViews = (() => {
      const analyticsLink = article.querySelector('a[href*="/analytics" i]');
      const txt = analyticsLink?.querySelector('span span')?.textContent;
      return parseCount(txt);
    })();

    return {
      textContent,
      displayName,
      username,
      profilePhotoUrl,
      timestamp,
      tweetLink,
      isAd,
      numberOfReplies,
      numberOfRetweets,
      numberOfLikes,
      numberOfViews
    };
  };

  const harvest = (roots) => {
    const incompleteTweets = [];
    
    roots.forEach((root) => {
      root.querySelectorAll?.('article[data-testid="tweet"]').forEach((article) => {
        if (tweets.length >= maxTweets) return;
        const data = extractTweet(article);
        if (data) {
          if (!data.profilePhotoUrl) {
            incompleteTweets.push({ article, data });
          } else {
            tweets.push(data);
          }
        }
      });
    });
    
    if (incompleteTweets.length > 0 && tweets.length < maxTweets) {
      setTimeout(() => {
        incompleteTweets.forEach(({ article, data }) => {
          if (tweets.length >= maxTweets) return;

          const img = article.querySelector('[data-testid^="UserAvatar-Container"] img');
          if (img) {
            const url = makeAbsolute(img.src);
            if (url && url !== 'https://x.com' && !url.includes('data:image/svg+xml')) {
              data.profilePhotoUrl = url;
              tweets.push(data);
            }
          }
        });
      }, 500);
    }
  };

  harvest([document]);

  const timeline = document.querySelector('main') || document.body;
  const observer = new MutationObserver((muts) => {
    muts.forEach((m) => {
      harvest(Array.from(m.addedNodes));
    });
  });
  observer.observe(timeline, { childList: true, subtree: true });

  /* -------------- auto-scroll until done ------------- */
  const scrollUntilDone = (resolve) => {
    if (tweets.length >= maxTweets) {
      observer.disconnect();
      const finalTweets = tweets.slice(0, maxTweets);
      
      const csv = generateCSV(finalTweets);
      
      downloadCSV(csv);
      
      return resolve({
        json: finalTweets,
        csv: csv
      });
    }
    window.scrollBy(0, window.innerHeight);
    setTimeout(() => scrollUntilDone(resolve), 100);
  };

  return new Promise((res) => scrollUntilDone(res));
};

const generateCSV = (tweets) => {
  if (!tweets || tweets.length === 0) return '';
  
  const headers = [
    'textContent',
    'displayName', 
    'username',
    'profilePhotoUrl',
    'timestamp',
    'tweetLink',
    'isAd',
    'numberOfReplies',
    'numberOfRetweets',
    'numberOfLikes',
    'numberOfViews'
  ];
  
  const csvRows = [headers.join(',')];
  
  tweets.forEach(tweet => {
    const row = headers.map(header => {
      const value = tweet[header];
      if (value === null || value === undefined) return '';
      const stringValue = String(value);
      if (stringValue.includes(',') || stringValue.includes('\n') || stringValue.includes('"')) {
        return `"${stringValue.replace(/"/g, '""')}"`;
      }
      return stringValue;
    });
    csvRows.push(row.join(','));
  });
  
  return csvRows.join('\n');
};

const downloadCSV = (csvContent) => {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, -5);
  const filename = `tweets-${timestamp}.csv`;
  
  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const link = document.createElement('a');
  
  if (link.download !== undefined) {
    const url = URL.createObjectURL(blob);
    link.setAttribute('href', url);
    link.setAttribute('download', filename);
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  }
};
