# Bölüm 6: Ürün Kapsamı

Bu belge KafiAI'nin kullanıcıya nasıl görüneceğini, neyi yapıp neyi yapmayacağını ve hangi özelliklerin hangi sırayla geleceğini anlatıyor. Modelin nasıl eğitildiği [Bölüm 4](04_concept_note.md) içinde, teknik kararların gerekçeleri [Bölüm 5](05_architecture_decisions.md) içinde.

---

## 1. Tek cümlede KafiAI

**Ekran süresi değil, kısır döngü.**

KafiAI, ChatGPT ve Gemini'yi tarayıcıda kullanan gençlerin yapay zekayla aynı yerde dönüp dönmediğini fark eden, bunu sakin bir göstergeyle görünür kılan ve tek tıkla çıkış yolu sunan, yapay zeka kullanımında iyi oluşla beraber insan irade ve bilincinin devre dışı kalmasının önüne geçen bir Chrome eklentisidir. Hiçbir mesaj cihazdan çıkmaz.

## 2. Kimin için?

Ders ve iş için üretken yapay zeka kullanan 18 ile 30 yaş arası üniversite öğrencileri ve genç çalışanlar. Bu grup yapay zekayı çoğunlukla bilgisayarda, tarayıcı üzerinden kullanıyor; eklentinin ilk sürümü de yalnızca masaüstü Chrome'u hedefliyor.

## 3. Kullanıcı ne yaşar?

### 3.1 Kurulum

Kurulumdan sonra kısa bir tanıtım ekranı çıkar. Ekranda üç şey yazar: eklentinin neye baktığı (gönderilen mesajlar ve cevabın bitişi), neye bakmadığı (klavye, diğer siteler, kişisel bilgiler) ve verinin cihazdan çıkmadığı.

Kullanıcı iki tercih yapar:

1. Yapay zekayı çoğunlukla ne için kullanıyor? (ders, iş, kod, kişisel)
2. İsterse kendine bir gece sınırı koyar.

### 3.2 Sohbet sırasında

Eklenti üç katmanda çalışır. Her katman bir öncekinden daha az sıklıkla devreye girer.

**Katman 1: Halka**

Mesaj kutusunun kenarında küçük bir halka durur. Sohbet verimli giderken neredeyse görünmezdir. Döngü sinyalleri arttıkça rengi yavaşça koyulaşır. Kırmızı alarm, puan ya da "risk" kelimesi yoktur. Üzerine gelindiğinde tek satır açıklama çıkar:

> Son üç mesajın birbirine çok benziyor.

Halkayı model besler. Model yanılsa bile kullanıcının önüne hiçbir şey çıkmaz; yalnızca halkanın tonu değişir.

**Katman 2: Gönderirken yakalama**

Kullanıcı son mesajlarından birine çok benzeyen bir mesaj göndermek üzereyse, mesaj kutusunun üstünde ince bir şerit belirir:

> Bunu az önce de sormuştun.
> **Yine de gönder** · **Neyin eksik olduğunu söyle**

İkinci seçenek üç hazır onarım düğmesi açar:

| Düğme | Mesaj kutusuna eklenen cümle |
|---|---|
| Biçim yanlış | "Cevabın içeriği doğru ama biçimi istediğim gibi değil. Şu biçimde yaz: ___" |
| Bilgi yanlış | "Önceki cevabın şu kısmı yanlış: ___. Sadece onu düzelt." |
| Fazla uzun ya da kısa | "Aynı cevabı daha kısa (ya da daha ayrıntılı) yaz." |

Kullanıcı boşlukları doldurur ve gönderir. Bu katman tahmine değil, gerçekten olmuş bir tekrara dayandığı için isabeti yüksektir.

**Katman 3: Çıkış kartı**

Döngü sürerse, yapay zekanın cevabı bittikten sonra ve kullanıcı yazmaya başlamadan önce küçük bir kart görünür:

> Kod hatası sohbetlerinin çoğu 6 turda bitiyor, bu 11. tur. Uzun sohbetlerde yapay zeka modelleri yolunu kaybedebiliyor; isteklerini tek mesajda toplayıp yeni sohbet açmak genelde daha hızlı.
> **Taze başlat** · **Kısa ara ver** · **Kapat**

"Taze başlat" düğmesi, kullanıcının o sohbette yazdığı istekleri madde madde tek bir taslakta toplar. Bu işlem cihazda, basit metin birleştirmeyle yapılır. Kullanıcı taslağı düzenler; taslak panoya kopyalanır ve yeni bir sohbet açılır.

Karttaki sayılar (bu tür işlerin genelde kaç turda bittiği) WildChat'teki talep türlerinin ortanca tur sayısından hesaplanır. Kart yalnızca bu sınırı aşan kullanıcılara gösterilir.

**Öğrenme sorusu**

Talep ödev ya da kavram öğrenmeye benziyorsa oturumda bir kez sorulur:

> Bunu öğrenmek mi, bitirmek mi istiyorsun?

Cevap "öğrenmek" ise iki öneri gelir: istemin başına "Önce ipucu ver, cevabı hemen söyleme" eklemek ve sohbetin sonunda "Bana bu konuda 3 kısa soru sor" demek.

### 3.3 Haftalık özet

Eklenti panelinde haftada bir güncellenen kısa bir özet bulunur. Özetteki her şey tahmin değil, kesin sayımdır:

| Bölüm | Örnek |
|---|---|
| Genel görünüm | Bu hafta 34 yapay zeka oturumu, 6'sında döngü |
| Ne zaman | Döngülerin 4'ü saat 23:00'ten sonra |
| Ne tür işte | En çok kod hatası ayıklarken |
| Ne işe yaradı | "Taze başlat" 3 kez kullanıldı, 2'sinde sohbet 3 turda bitti |
| Değişim | Geçen haftaya göre daha az döngü |

Bu ekranda yargılayan bir dil kullanılmaz, kimseyle kıyaslama ya da sıralama yapılmaz.

### 3.4 Destek yolu

Destek yolu kademelidir ve her adım kullanıcının isteğine bağlıdır:

1. Sohbet içinde onarım ve çıkış önerileri
2. Haftalık özet
3. Birkaç hafta üst üste yoğun örüntü görülürse isteğe bağlı kısa bir öz değerlendirme
4. Kullanıcı isterse Yeşilay Danışmanlık Merkezi (YEDAM) bilgisi. Mesai saatleri dışında telefon yerine e-randevu bağlantısı gösterilir.

Tek bir sohbete bakılarak kimse YEDAM'a yönlendirilmez. Metinler "İstersen..." diye başlayan, kişiyi suçlamayan bir dille yazılır.

## 4. Özellikler ve öncelik sırası

| Öncelik | Özellik | Ne işe yarar |
|---|---|---|
| Çekirdek | ChatGPT ve Gemini sohbetlerini okuma | Gönderilen mesajları ve cevabın bitişini yakalar |
| Çekirdek | Tekrar tespiti ve gönderirken uyarı şeridi | Tekrarı olduğu anda yakalar |
| Çekirdek | Onarım düğmeleri | Kullanıcıya neyin eksik olduğunu söylemenin hazır yolunu verir |
| Çekirdek | Halka | Modelin erken sinyalini sakin bir şekilde gösterir |
| Çekirdek | Çıkış kartı, görev normları ve "Taze başlat" | Uzayan döngüden tek tıkla çıkış |
| Çekirdek | Ayarlar | Hassasiyet, kapatma, "bu öneri yerinde değildi", tüm veriyi silme |
| Çekirdek | Haftalık özet | Örüntüyü kesin sayımlarla görünür kılar |
| İkinci dalga | Öğrenme sorusu ve "kendini test et" önerisi | Öğrencilerin aracı düşünmeyi destekleyecek şekilde kullanması |
| İkinci dalga | Kademeli destek yolu ve YEDAM e-randevu bağlantısı | Gerektiğinde profesyonel desteğe kapı açar |
| İkinci dalga | Kendi koyduğun gece sınırı ve "yarına ertele" | Gece saatlerinde açılan yeni sohbetler için hatırlatma |
| Sonraki sürüm | Copilot ve Claude desteği | Daha fazla platform |
| Sonraki sürüm | Kişiye göre ayarlanan eşik | Herkesin kendi alışkanlığına göre öneri |
| Sonraki sürüm | Veri bağışı | Kullanıcının kendi ChatGPT verisini, içerik paylaşmadan, yalnızca özet öznitelik olarak bağışlaması |
| Sonraki sürüm | Telefon uygulaması | Mobil kullanımın da görülmesi |

## 5. Ürünün yapmayacakları

- Mesaj metnini saklamaz ve hiçbir sunucuya göndermez. Kodda ağ isteği yoktur.
- Klavye tuşlarını izlemez, diğer sitelere bakmaz.
- Hiçbir şeyi engellemez, süre sınırı koymaz.
- "Bağımlısın" demez, puan vermez; seri, rozet ya da oyunlaştırma kullanmaz.
- Ebeveyn ya da işveren modu yoktur; eklenti yalnızca kullanıcının kendisine konuşur.
- Kişisel ve duygusal sohbetlerde verimlilik önerisi göstermez.
- Sayfa yapısı değişip emin olamadığında sessizce devre dışı kalır.

## 6. Arka planda neler çalışıyor?

Eklentinin içinde iki ayrı karar mekanizması bulunur:

| Mekanizma | Neye dayanır | Neyi tetikler | Yanılırsa ne olur |
|---|---|---|---|
| Kesin kurallar | Mesaj benzerliği, tur sayısı, görev normları | Uyarı şeridi; görev normunu aşan sohbette çıkış kartı | Nadiren yanılır, çünkü olmuş bir şeyi ölçer (şerit eşiğinde tahmini isabet %83) |
| Tur modeli | Kullanıcının o ana kadarki mesajlarından 22 öznitelik; kalibre edilmiş olasılık | Yalnızca yüksek güvende ve sohbette en az bir "olmadı" ifadesi varsa gerekçeli çıkış kartı | Kart kapatılabilir; testte kart açıldığında yaklaşık 8 seferden 3'ünde sohbet gerçekten döngüye giriyor |

İlk tasarımda model yalnızca halkanın tonunu etkileyecekti, çünkü tek bir sohbet için erken tahminin isabeti sınırlı. Model kalibre edilip kanıt şartı eklendikten sonra (Bölüm 5, K17) kartı da açabiliyor; ama kart yine engellemiyor, gerekçesini söylüyor ve "Yerinde değildi" seçeneği sunuyor. Halka henüz yok.

## 7. Pilot çalışma

| Konu | Plan |
|---|---|
| Katılımcılar | Yakın çevremizden 10 kişi; 18 ile 30 yaş arası, yapay zekayı ders veya iş için kullanan |
| Süre | Bir hafta. İlk iki gün öneriler kapalı, yalnızca sayım yapılır; sonraki günler öneriler açılır. |
| Hazırlık | Kısa aydınlatma metni, rıza formu, kurulum rehberi |
| Ölçülenler | Şerit veya kart gösterildikten sonraki mesajın tekrar olma oranı; "yerinde değildi" oranı; düğmelerin kullanımı; hafta sonunda kısa anket |
| Nasıl sunulacak | Doğruluk iddiası olmadan, bir uygulanabilirlik denemesi olarak. Katılımcıların yakın çevreden seçildiği ve sayının küçük olduğu açıkça yazılacak. |

## 8. Başarıyı nasıl anlayacağız?

| Soru | Ölçüt |
|---|---|
| Öneriler işe yarıyor mu? | Şerit veya kart gösterildikten sonra bir sonraki mesajın tekrar olma oranı, öneri kapalıyken olan orandan düşük mü? |
| Kullanıcıyı rahatsız ediyor mu? | "Yerinde değildi" oranı ve eklentiyi kapatan kullanıcı sayısı |
| Anlaşılıyor mu? | Ankette "neden uyarıldığımı anladım" diyenlerin oranı |
| Gizlilik vaadi tutuyor mu? | Eklentinin hiçbir ağ isteği yapmadığının açık kaynak kodla gösterilmesi |

## 9. Uygulama durumu (Ekim 2026)

Yukarıdaki bölümler hedef ürünü anlatıyor. Aşağıdaki tablo `extension/` klasöründeki gerçek durumu gösteriyor. Bu bölüm her önemli özellikten sonra güncellenir.

| Özellik | Durum | Not |
|---|---|---|
| ChatGPT ve Gemini sohbetlerini okuma | Hazır | Gönderme, cevabın bitişi, sohbet geçişi ve geçmişi okuma iki sitede de canlı sınandı. Gemini Gems sayfaları ve çok uzun sohbetlerde tembel yüklenen geçmiş doğrulanmadı. Claude, Copilot ve Google AI Modu henüz yok. |
| Tekrar tespiti ve gönderirken uyarı şeridi | Hazır | Karakter 3-gram, son 5 mesaj. Şerit eşiği 0,8; 0,6 ile 0,8 arası yalnızca çıkış kartı için sayılır (Bölüm 5, K14). "Yine de gönder", "Yerinde değildi", "Kapat" seçenekleri var. |
| Onarım düğmeleri | Hazır | Seçilen cümle mesaj kutusuna yeni satır olarak eklenir. |
| Tur modeli | Hazır | 22 öznitelikli Logistic Regression, eklentide JSON olarak (`src/data/turn-model.json`); her gönderimde yeniden hesaplanır. Python ile birebir aynı sonucu verdiği parite testleriyle kontrol ediliyor (Bölüm 9, K17). |
| Çıkış kartı ve "Taze başlat" (Katman 3) | Hazır | İki yoldan açılır: görev normunu aşan ve en az bir tekrar olan sohbet (K14) ya da modelin yüksek güvenli tahmini ve kanıt şartı (K17). Model kaynaklı kart gerekçe, somut öneri ve "Yerinde değildi" düğmesi gösterir. "Taze başlat", "Kısa ara ver", "Kapat" ve "Bir daha gösterme" çalışıyor. 5 tur bekleme süresi iki yol için de aynı. |
| Halka (Katman 1) | Yok | Yalnızca sağlık ölçütlerini geçerse, bayrak arkasında ve varsayılan kapalı eklenecek. |
| Öğrenme sorusu | Yok | İkinci dalga. |
| Ayarlar | Kısmen | Eklenti açma/kapama, "Öneriler" (kapalıyken yalnızca say modu), çıkış kartı açma/kapama, "Sayaçlarımı kopyala" ve "Tüm verilerimi sil" araç çubuğu penceresinde. Hassasiyet ayarı yok. "Yerinde değildi" şeritte ve model kartında, yalnızca sayaç olarak. |
| Haftalık özet | Kısmen | Pencerede son 7 günün sayaçları var (şerit, "Yine de gönder", onarım, çıkış kartı, modelin önerdiği kartlar, "Taze başlat"). Saat, görev türü, platform ve önceki haftayla değişim bölümleri yok. |
| Kurulum tanıtım ekranı ve tercihler | Yok | Sonraki aşama. |
| Kademeli destek yolu ve YEDAM bağlantısı | Yok | İkinci dalga. Eklenti şu an hiçbir yere yönlendirme yapmıyor. |
| Gece sınırı ve "yarına ertele" | Yok | İkinci dalga. |
| Ağ isteği yok | Hazır | Eklenti sayfaları ve arka plan çalışanında `connect-src 'none'`; içerik betiği için derlenmiş kodda ağ API'si geçmediğini denetleyen test (Bölüm 5, K11). |

**Pilot ölçüm altyapısı.** "Öneriler" kapalıyken eklenti yalnızca sayar: şerit ve çıkış kartı gösterilmez, mesajlar bekletilmez. Gönderilen mesajlar açık ve kapalı günler için ayrı sayılır (karşılaştırılabilen ve bunlardan benzer olan gönderimler). Günlük tekrar oranı, benzer gönderimlerin karşılaştırılan gönderimlere bölünmesiyle bulunur. Kapalıyken şerit, çıkış kartı ya da model kartı gösterilecek olsaydı bu da ayrıca sayılır. Sayaçlar yalnızca sayıdır; pencereden "Sayaçlarımı kopyala" ile alınabilir.

**Pilottan önce eksik olanlar.**

- Bölüm 8'deki ilk ölçüt ("şerit veya kart gösterildikten sonra bir sonraki mesajın tekrar olma oranı") ile uygulanan ölçüt (günlük tekrar oranı) aynı tanım değil; pilot hazırlığında uygulanan tanıma eşitlenecek.
- Açık ve kapalı günleri katılımcı elle değiştiriyor; kurulumdan itibaren otomatik geçiş yok.
- Sayaçlar platform, saat dilimi ve sohbet uzunluğuna göre ayrılmıyor (sayaç şemasının ikinci sürümünde).
- Rıza ve aydınlatma metni, kurulum rehberi ve anket henüz hazır değil.
