# Zincir ve Kıvılcım: mobil oyun ve uygulama fikir raporu

`index.html` dosyasını tarayıcıda aç. Tek sayfada şunlar var:

1. 2026 mobil listelerinin (Google Play + App Store) taraması ve çıkarılan dersler
2. 8 farklı hedef kitleden oyuncunun gözünden değerlendirme
3. 10 oyun + 6 uygulama fikrinin 5 ölçütte puanlanması
4. Karar: **Zincir**, tek dokunuşla zincirleme patlama bulmacası (oynanabilir prototip, oyun tasarımı, gelir modeli, teknik plan, 6 haftalık yol haritası, KPI'lar)
5. Uygulama kararı: **Kıvılcım**, arkadaş grupları için günlük, anonim ve pozitif oylama (tıklanabilir prototip)

`sayfa.html`, artifact olarak yayınlanan kaynak; `index.html` ise aynı içeriğin tek başına açılabilen hali.

Prototipteki oyun çekirdeği (deterministik simülasyon, çözücü, seviye üretici) render koduna bağlı değil ve doğrudan C#/Dart'a taşınabilir.

## Filiz: rahatlatıcı hayatta kalma oyunu

`filiz/index.html`: tek parmakla oynanan 3 dakikalık bir survivor/roguelite prototipi. Düşmanları yok etmek yerine gri sisleri çiçeğe çeviriyorsun; tur sonunda geriye yeşerttiğin bahçe kalıyor. Dokuz yetenek, seviye atlayınca üçlü seçim, bahar finali, sonuç ekranı ve tohumlarla kalıcı güçlenmeler var. `filiz/sayfa.html` artifact olarak yayınlanan kaynak.

## Yumak: ip sanatı bulmacası

`yumak/index.html`: çivilerin etrafına ip dolayarak desen ördüğün rahatlatıcı bir bulmaca. Her ip parçası uzunluğuna göre tel gibi bir nota çalar (Karplus-Strong). 9 desen, çok renkli ipler, en kısa ipe göre yıldız (açık Çinli Postacı çözümü), geri al ve tellerini çalma modu var. `yumak/sayfa.html` artifact olarak yayınlanan kaynak.

## Yün Şövalye: karakter gelişimli örgü macerası

`yun-sovalye/index.html`: örgü bir bebek kahramanın ekipmanını atölyede Yumak bulmacasıyla örüp (en kısa ip = en güçlü eşya), 3 şeritli dikey maceralarda güvelerle savaştığı prototip. Hasar kahramanda kalıcı delik açar, atölyede yama örerek kapatılır. 8 bölüm, 2 boss (Kraliçe Güve, Makas Bey), 4 eşya + yama deseni, 3 ip türü, ilmek ağacı, Örgü Kedi yoldaşı ve kayıtlı ilerleme var. `yun-sovalye/sayfa.html` artifact olarak yayınlanan kaynak.
