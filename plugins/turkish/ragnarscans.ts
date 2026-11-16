import { load as parseHTML } from 'cheerio';
import { fetchApi } from '@libs/fetch';
import { Plugin } from '@/types/plugin';
import { FilterTypes, Filters } from '@libs/filterInputs';
import { defaultCover } from '@libs/defaultCover';
import { NovelStatus } from '@libs/novelStatus';

type InitSearchItem = {
  id: number;
  title: string;
  url: string;
  type?: string;
  post_type?: string;
  thumb?: string;
};

type InitChapterItem = {
  id: number;
  title?: string;
  number: number;
  slug: string;
  created_at?: string;
  lock_type?: string;
  is_purchased?: boolean;
};

type InitChaptersResponse = {
  items: InitChapterItem[];
  total_pages: number;
  current_page: number;
};

const STATUS_MAP: Record<string, string> = {
  ongoing: NovelStatus.Ongoing,
  completed: NovelStatus.Completed,
  season_end: NovelStatus.OnHiatus,
  source_hiatus: NovelStatus.OnHiatus,
  caught_up: NovelStatus.Ongoing,
  dropped: NovelStatus.Cancelled,
};

class RagnarScansPlugin implements Plugin.PluginBase {
  id = 'ragnarscans';
  name = 'Ragnar Scans MZ';
  icon = 'src/tr/ragnarscans/icon.png';
  site = 'https://ragnarscans2.com/';
  version = '1.0.2';

  filters = {
    sort: {
      label: 'Sıralama',
      value: 'views',
      type: FilterTypes.Picker,
      options: [
        { label: 'En Çok Okunan', value: 'views' },
        { label: 'Son Güncellenen', value: 'updated' },
        { label: 'Yeni Eklenen', value: 'new' },
        { label: 'Puan', value: 'rating' },
        { label: 'Güç', value: 'power' },
        { label: 'Takip Edilen', value: 'follow' },
      ],
    },
    status: {
      label: 'Durum',
      value: '',
      type: FilterTypes.Picker,
      options: [
        { label: 'Tümü', value: '' },
        { label: 'Devam Ediyor', value: 'ongoing' },
        { label: 'Tamamlandı', value: 'completed' },
        { label: 'Sezon Finali', value: 'season_end' },
        { label: 'Ara Verildi', value: 'source_hiatus' },
        { label: 'Güncel', value: 'caught_up' },
        { label: 'Bırakıldı', value: 'dropped' },
      ],
    },
    genres: {
      label: 'Türler',
      value: [],
      type: FilterTypes.CheckboxGroup,
      options: [
        { label: 'Aksiyon', value: 'aksiyon' },
        { label: 'Dövüş Sanatları', value: 'dovus-sanatlari' },
        { label: 'Doğaüstü', value: 'dogaustu' },
        { label: 'Dram', value: 'dram' },
        { label: 'Drama', value: 'drama' },
        { label: 'Fantastik', value: 'fantastik' },
        { label: 'Komedi', value: 'komedi' },
        { label: 'Macera', value: 'macera' },
        { label: 'Romantizm', value: 'romantizm' },
        { label: 'Shounen', value: 'shounen' },
      ],
    },
  } satisfies Filters;

  private stripSite(url: string): string {
    return url.replace(this.site, '').replace(/^\/+/, '');
  }

  async popularNovels(
    pageNo: number,
    {
      showLatestNovels,
      filters,
    }: Plugin.PopularNovelsOptions<typeof this.filters>,
  ): Promise<Plugin.NovelItem[]> {
    const params = new URLSearchParams();
    params.set('type', 'novel');
    params.set(
      'sort',
      showLatestNovels ? 'updated' : filters?.sort?.value || 'views',
    );

    if (filters?.status?.value) {
      params.set('status', filters.status.value);
    }
    if (filters?.genres?.value?.length) {
      for (const genre of filters.genres.value) {
        params.append('genre[]', genre);
      }
    }

    const pageSegment = pageNo > 1 ? `page/${pageNo}/` : '';
    const url = `${this.site}gelismis-filtre/${pageSegment}?${params.toString()}`;

    const res = await fetchApi(url);
    const body = await res.text();
    const $ = parseHTML(body);

    const novels: Plugin.NovelItem[] = [];
    $('.manga-item-details').each((_, el) => {
      const link = $(el).find('h2 a.uk-link-heading');
      const name = link.text().trim();
      const href = link.attr('href');
      if (!name || !href || !href.includes('/novel/')) return;

      const cover =
        $(el).find('img').attr('src') ||
        $(el).find('img').attr('data-src') ||
        defaultCover;

      novels.push({
        name,
        path: this.stripSite(href),
        cover,
      });
    });

    return novels;
  }

  async parseNovel(novelPath: string): Promise<Plugin.SourceNovel> {
    const cleanPath = this.stripSite(novelPath);
    const url = `${this.site}${cleanPath}`;
    const res = await fetchApi(url);
    const body = await res.text();
    const $ = parseHTML(body);

    const novel: Plugin.SourceNovel = {
      path: cleanPath,
      name: $('h1').first().text().trim() || 'Untitled',
      cover: $('.story-cover img').attr('src') || defaultCover,
    };

    const summaryParagraphs = $('#manga-description p')
      .map((_, el) => $(el).text().trim())
      .get()
      .filter(Boolean);
    if (summaryParagraphs.length) {
      novel.summary = summaryParagraphs.join('\n\n');
    }

    const genres = Array.from(
      new Set(
        $('a[href*="/genre/"]')
          .map((_, el) => $(el).text().trim())
          .get()
          .filter(Boolean),
      ),
    );
    if (genres.length) {
      novel.genres = genres.join(', ');
    }

    novel.status = NovelStatus.Unknown;
    $('script[type="application/ld+json"]').each((_, el) => {
      try {
        const parsed = JSON.parse($(el).text());
        const props = parsed?.additionalProperty;
        if (Array.isArray(props)) {
          const statusProp = props.find(
            (p: { name?: string; value?: string }) => p?.name === 'status',
          );
          if (statusProp?.value && STATUS_MAP[statusProp.value]) {
            novel.status = STATUS_MAP[statusProp.value];
          }
        }
      } catch {
        // Ignore malformed ld+json blocks
      }
    });

    if (novel.status === NovelStatus.Unknown) {
      const ribbonText = $('.manga-status-ribbon__text')
        .first()
        .text()
        .trim()
        .toLowerCase();
      if (ribbonText.includes('devam')) {
        novel.status = NovelStatus.Ongoing;
      } else if (ribbonText.includes('tamam')) {
        novel.status = NovelStatus.Completed;
      }
    }

    const postIdMatch =
      ($('body').attr('class') || '').match(/postid-(\d+)/) ||
      body.match(/window\.post_id\s*=\s*(\d+)/);
    const mangaId = postIdMatch?.[1];

    const chapters: Plugin.ChapterItem[] = [];
    if (mangaId) {
      const baseApi = `${this.site}wp-json/initmanga/v1/chapters?manga_id=${mangaId}&per_page=50`;
      const firstRes = await fetchApi(`${baseApi}&page=1`);
      const firstData = (await firstRes.json()) as InitChaptersResponse;
      const allItems: InitChapterItem[] = [...(firstData.items || [])];
      const totalPages = Number(firstData.total_pages) || 1;

      const batchSize = 4;
      for (let start = 2; start <= totalPages; start += batchSize) {
        const end = Math.min(start + batchSize - 1, totalPages);
        const pageNumbers: number[] = [];
        for (let p = start; p <= end; p++) {
          pageNumbers.push(p);
        }
        const batchResults = await Promise.all(
          pageNumbers.map(async p => {
            const pageRes = await fetchApi(`${baseApi}&page=${p}`);
            return (await pageRes.json()) as InitChaptersResponse;
          }),
        );
        for (const pageData of batchResults) {
          if (Array.isArray(pageData.items)) {
            allItems.push(...pageData.items);
          }
        }
      }

      const normalizedNovelPath = cleanPath.replace(/\/+$/, '');
      for (const item of allItems.reverse()) {
        if (!item.slug) continue;
        const isLocked =
          item.lock_type && item.lock_type !== 'none' && !item.is_purchased;
        const baseName = item.title
          ? `Bölüm ${item.number}: ${item.title}`
          : `Bölüm ${item.number}`;
        chapters.push({
          name: isLocked ? `🔒 ${baseName}` : baseName,
          path: `${normalizedNovelPath}/${item.slug}/`,
          releaseTime: item.created_at
            ? item.created_at.split(' ')[0]
            : undefined,
          chapterNumber: item.number,
        });
      }
    } else {
      $('#chapter-list a[href*="/novel/"]').each((_, el) => {
        const href = $(el).attr('href');
        const text = $(el).text().replace(/\s+/g, ' ').trim();
        if (!href || href.includes('?rev=') || text === 'From Start') return;
        chapters.push({
          name: text,
          path: this.stripSite(href),
        });
      });
      chapters.reverse();
    }

    novel.chapters = chapters;
    return novel;
  }

  async parseChapter(chapterPath: string): Promise<string> {
    const url = `${this.site}${this.stripSite(chapterPath)}`;
    const res = await fetchApi(url);
    const body = await res.text();
    const $ = parseHTML(body);

    const content = $('#chapter-content');
    if (content.find('.lock-card').length > 0) {
      throw new Error(
        'Bu bölümü okumak için LNReader WebView üzerinden ragnarscans2.com hesabınıza giriş yapın.',
      );
    }

    content.find('script, style, .lock-card').remove();
    const html = (content.html() || '').trim();
    if (!html) {
      if (body.includes('InitMangaEncryptedChapter')) {
        throw new Error(
          'Bu bölüm ragnarscans2.com tarafından şifreli/korumalı (InitMangaEncryptedChapter / headless_guard) olarak sunuluyor; yalnızca WebView veya tarayıcı üzerinden okunabilir.',
        );
      }
      throw new Error('Bölüm içeriği boş döndü.');
    }

    return html;
  }

  async searchNovels(
    searchTerm: string,
    pageNo: number,
  ): Promise<Plugin.NovelItem[]> {
    if (pageNo > 1) return [];

    const url = `${this.site}wp-json/initlise/v1/search?term=${encodeURIComponent(
      searchTerm,
    )}&per_page=20`;
    const res = await fetchApi(url);
    const items = (await res.json()) as InitSearchItem[];
    if (!Array.isArray(items)) return [];

    const novels: Plugin.NovelItem[] = [];
    for (const item of items) {
      if (!item.url || !item.url.includes('/novel/')) continue;
      novels.push({
        name: item.title,
        path: this.stripSite(item.url),
        cover: item.thumb || defaultCover,
      });
    }

    return novels;
  }

  resolveUrl = (path: string) => `${this.site}${this.stripSite(path)}`;
}

export default new RagnarScansPlugin();
