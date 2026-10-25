# Bölüm 5: Mimari Kararlar

Bu belge projede verdiğimiz teknik kararları ve nedenlerini kayıt altına alıyor. Her karar aynı düzende yazıldı: bağlam, karar, neden, bedeli. Yeni bir karar alındığında listenin sonuna eklenir; eski bir karar değişirse silinmez, "değiştirildi" notu düşülür.

| # | Karar | Durum |
|---|---|---|
| K01 | Problem, ilk turlardan erken uyarı olarak tanımlanır | Kabul |
| K02 | Etiket önce kurallarla, sonra hazır ve LLM etiketleri ile insan doğrulamasıyla üretilir | Kabul |
| K03 | Benzerlik için eğitimsiz karakter n-gram vektörü kullanılır | Kabul |
| K04 | Veri kullanıcı bazlı bölünür | Kabul |
| K05 | İlk model küçük ve açıklanabilirdir, tarayıcıda çalışır | Kabul |
| K06 | Tüm eşikler tek bir ayar dosyasında tutulur | Kabul |
| K07 | Tahmin ile tespit ayrılır; öneriler kesin sinyallerle tetiklenir | Değiştirildi (K17) |
| K08 | Eğitim verisi WildChat 4.8M, hazır etiket kaynağı WildFeedback olur | Kabul |
| K09 | Eklentinin ilk sürümü modelsiz, kural tabanlı çalışır; kesinti yalnızca benzer mesajda olur | Değiştirildi (K17) |
| K10 | Siteler ortak bir adaptör arayüzüyle desteklenir; sayfa yapısı tanınmazsa eklenti sessizce devre dışı kalır | Kabul |
| K11 | Mesaj metni yalnızca bellekte tutulur; eklentide ağ isteği yapan kod yoktur | Kabul (düzeltildi) |
| K12 | Ayarlar araç çubuğu penceresinde, yalnızca Türkçe; saklanan tek veri iki ayar ve günlük sayaçlar | Değiştirildi (K18) |
| K13 | Çıkış kartı eşikleri geçicidir, WildChat ile kalibre edilecek | Değiştirildi (K14) |
| K14 | Eşikler WildChat ile kalibre edildi: şerit 0,8, yumuşak tekrar 0,6, çıkış kartı görev normuna göre | Kabul |
| K15 | Etiketin ikinci sürümü: benzerlik değil güçlü onarım ifadeleri esas alınır | Kabul |
| K16 | Model WildChat 4.8M ile eğitilir; eklenti için 25 öznitelikli Logistic Regression seçilir | Değiştirildi (K17) |
| K17 | Eklentide her mesajda çalışan, kalibre edilmiş tur modeli; kart yalnızca yüksek güven ve kanıt şartıyla | Kabul |
| K18 | Sayaç şeması v2: günlük, seyrek, boyutlu ve yalnızca sayı; ortak JSON şemasıyla doğrulanır | Kabul |
| K19 | Platform kaydı: desteklenen siteler ve yetenekleri tek yapılandırma dosyasında | Kabul |

---

## K01. Problem, ilk turlardan erken uyarı olarak tanımlanır

**Bağlam.** Bir sohbetin döngüye girdiğini sohbet bittikten sonra söylemek kolay ama işe yaramaz; kullanıcı zamanı zaten kaybetmiş olur.

**Karar.** İlk sürümde model kullanıcının yalnızca ilk iki mesajını görür ve sohbetin geri kalanında döngü olup olmayacağını tahmin eder (`config.K_TURNS = 2`). Etiket, modelin görmediği kısımdan üretilir.

**Neden.** Eklenti uyarıyı döngü başlamadan önce verebilir. Ayrıca girdi ve etiket farklı turlardan geldiği için etiket bilgisinin modele sızması yapısal olarak engellenir.

**Bedeli.** İlk iki tur az bilgi taşır, bu yüzden başarı tavanı düşüktür. Sonraki aşamada aynı modeli 3. ve 4. turlarda da çalıştırıp uyarıyı güncellemeyi deneyeceğiz.

## K02. Etiket önce kurallarla, sonra hazır ve LLM etiketleri ile insan doğrulamasıyla üretilir

**Bağlam.** Hiçbir açık veri setinde "verimsiz döngü" etiketi yok.

**Karar.** İlk sürümde etiket açık kurallarla üretilir (`labels.py`): ikinci turdan sonra en az 2 tekrar veya en az 2 onarım ifadesi. Sonra İngilizce sohbetler için WildFeedback'teki hazır memnuniyetsizlik etiketleri, Türkçe sohbetler için aynı ölçütle bir dil modeli kullanılır; 300 sohbet (en az 100'ü Türkçe) elle doğrulanır. "Devam et" gibi kısa ve meşru tekrarlar etiketten ayıklanır.

**Neden.** Kurallar hızlı ve denetlenebilir; veri hattını hemen kurmamızı sağlar. LLM, kuralların kaçırdığı anlam düzeyindeki tekrarları yakalar. İnsan doğrulaması iki yöntemin ne kadar güvenilir olduğunu sayıyla gösterir.

**Bedeli.** Kural tabanlı etiketle eğitilen model, kuralları yeniden öğrenmeye eğilimlidir. Bu yüzden nihai değerlendirme yalnızca elle doğrulanmış set üzerinde yapılacak.

## K03. Benzerlik için eğitimsiz karakter n-gram vektörü kullanılır

**Bağlam.** Bölüm 2'de hem TF-IDF hem çok dilli embedding denedik. Embedding anlam benzerliğini daha iyi yakalıyor ama tarayıcıda ek bir model gerektiriyor.

**Karar.** Öznitelik ve kural etiketinde `HashingVectorizer` (karakter 3 ile 5 gram) kullanılır. Çok dilli embedding, LLM etiketleme ve ileri model karşılaştırması için ayrı tutulur.

**Neden.** HashingVectorizer eğitim gerektirmez; aynı hesap JavaScript ile birebir yapılabilir. Python'da eğitilen model ile tarayıcıda çalışan model aynı sayıları görür.

**Bedeli.** "Bu kodu düzelt" ile "kodda hata var, tekrar yazar mısın" gibi anlamca aynı ama kelimece farklı mesajları kaçırır. Bu açığı onarım ifadesi özniteliği kısmen kapatıyor.

**Not (eklenti uygulaması).** Eklentinin ilk sürümü yalnızca karakter 3-gram kullanıyor: 1024 boyutlu karma vektör, kosinüs benzerliği, eşik 0,6, en az 12 karakter, son 5 mesajla karşılaştırma (`extension/src/config.ts`). Bu karar metnindeki 3 ile 5 gram aralığı model aşamasında Python ile JavaScript arasında birebir eşleştirilecek; o zamana kadar iki taraftaki değerler ayrı ayrı belgelenmeli.

**Not (Python ikizi).** Eklentinin benzerlik hesabı `src/kafiai/extension_similarity.py` dosyasında Python'a birebir aktarıldı. İki tarafın aynı sonucu verdiği `tests/fixtures/similarity_parity.json` üzerinden hem Python hem eklenti testleriyle denetleniyor; ortak ayar değerlerinin eşitliğini de `tests/test_extension_parity.py` kontrol ediyor. Eşik değeri K14 ile 0,8'e çıkarıldı.

## K04. Veri kullanıcı bazlı bölünür

**Bağlam.** WildChat'te en yoğun %1 kullanıcı sohbetlerin %28'ini oluşturuyor.

**Karar.** Eğitim ve test ayrımı şifrelenmiş IP'ye göre yapılır (`split.user_split`). Aynı kişinin sohbetleri iki tarafta birden bulunmaz.

**Neden.** Rastgele bölmede model yoğun kullanıcıların yazım tarzını ezberler ve test skoru gerçekte olduğundan iyi görünür.

**Bedeli.** Test seti küçülür ve skorlar daha dalgalı olur. Bunu ileride kullanıcı bazlı çapraz doğrulama (GroupKFold) ile dengeleyeceğiz.

## K05. İlk model küçük ve açıklanabilirdir, tarayıcıda çalışır

**Bağlam.** Ürün kullanıcının bilgisayarında çalışacak; mesajlar dışarı gönderilmeyecek. Chrome'un yerleşik modeli Türkçeyi desteklemiyor.

**Karar.** Karşılaştırma sırası: kural, Logistic Regression, XGBoost. Logistic Regression seçilirse katsayılar küçük bir JSON dosyası olarak eklentiye konur; ek bir kütüphane gerekmez. XGBoost seçilirse ONNX formatına çevrilip ONNX Runtime Web ile çalıştırılır. Transformer modeller yalnızca belirgin fark yaratırsa ve 150 ms sınırına sığarsa kullanılır.

**Neden.** Küçük, hızlı ve SHAP ile açıklanabilir. Her uyarının gerekçesini göstermek ürünün temel ilkelerinden biri.

**Bedeli.** Metnin anlamını doğrudan okuyan büyük modellerin doğruluğuna ulaşamayabilir.

## K06. Tüm eşikler tek bir ayar dosyasında tutulur

**Bağlam.** Benzerlik eşiği, etiket kuralı ve şablon tespiti gibi değerler deneyler boyunca değişecek.

**Karar.** Hepsi `src/kafiai/config.py` içinde, yanında gerekçesiyle durur.

**Neden.** Bir değeri değiştirmek için kodun içinde arama yapmak gerekmez; rapordaki sayılar ile koddaki değerler aynı yerden okunur.

**Bedeli.** Yok denecek kadar az.

**Not (eklenti uygulaması).** Aynı ilke eklentide `extension/src/config.ts` ile uygulanıyor. Python ve JavaScript tarafındaki ortak değerler (n-gram boyutu, vektör boyutu, benzerlik eşiği) değiştiğinde iki dosya birlikte güncellenmeli.

## K07. Tahmin ile tespit ayrılır; öneriler kesin sinyallerle tetiklenir

**Bağlam.** Döngüler sohbetlerin yaklaşık %10'unda görülüyor. Bu oranda, döngülerin yarısını yakalayıp normal sohbetlerin %90'ını rahat bırakan iyi bir model bile verdiği her üç uyarıdan yaklaşık ikisinde yanılır. Ayrıca döngü, henüz yazılmamış yapay zeka cevaplarına bağlı olduğu için erken tahminin bir tavanı var.

**Karar.** Model yalnızca mesaj kutusunun kenarındaki halkanın tonunu etkiler. Kullanıcının önüne çıkan öneriler kesin sinyallerle tetiklenir: gerçekleşmiş bir tekrar uyarı şeridini, görev normunu aşan tur sayısı çıkış kartını açar. Haftalık özet yalnızca kesin sayımlardan oluşur.

**Neden.** Yanılma ihtimali olan sinyal kullanıcıyı rahatsız etmez; kullanıcıyı yönlendiren öneriler ise olmuş bir şeye dayanır. Ürünün değeri modelin isabetine bağlı kalmaz.

**Bedeli.** Model kullanıcıyı tek başına yönlendiremediği için bazı döngüler ancak başladıktan sonra yakalanır.

**Değiştirildi (K17).** Tur modeli kalibre edildikten sonra model de kullanıcıya görünen bir öneriyi tetikleyebiliyor: çıkış kartı, görev normuna ek olarak modelin yüksek güven eşiğini geçtiği ve sohbette en az bir güçlü onarım ifadesi bulunduğu turda açılabiliyor. Tahmin ile tespit ayrımı korunuyor: şerit yalnızca gerçekleşmiş tekrarda çıkıyor, model kartı ise bir tahmin olduğunu ve gerekçesini söylüyor.

## K08. Eğitim verisi WildChat 4.8M, hazır etiket kaynağı WildFeedback olur

**Bağlam.** Keşif analizini WildChat 1M ile yaptık. Bu sürüm 2023 ile 2024 arasını ve eski modelleri kapsıyor; Türkçe sohbet sayısı da az.

**Karar.** Model eğitiminde Ağustos 2025'e kadar uzanan, yaklaşık 3,2 milyon sohbetlik WildChat 4.8M kullanılır. İngilizce sohbetlerde ikinci etiket katmanı olarak Microsoft'un WildFeedback veri setindeki tur bazlı memnuniyetsizlik etiketleri kullanılır.

**Neden.** Daha güncel modeller ve kullanım biçimleri, daha fazla Türkçe sohbet. WildFeedback etiketleri, aynı yöntemi kendimiz uygulamanın maliyetini ve süresini ortadan kaldırıyor.

**Bedeli.** WildFeedback etiketleri bir dil modeli tarafından üretildi; insan etiketi gibi değil, ikinci bir görüş gibi kullanılmalı. Veri seti büyük olduğu için tamamı değil, akış halinde örneklem alınarak kullanılacak.

## K09. Eklentinin ilk sürümü modelsiz, kural tabanlı çalışır; kesinti yalnızca benzer mesajda olur

**Bağlam.** K05 küçük bir modelin tarayıcıda çalışmasını öngörüyor, K07 ise önerilerin kesin sinyallerle tetiklenmesini istiyor. Eğitilecek modelin henüz olmaması, ürünün kullanıcıya değer vermeye başlamasını engellememeli.

**Karar.** İlk sürümde eklenti yalnızca kesin sinyallerle çalışır: gönderim anında mesaj son 5 mesajla karşılaştırılır; benzerlik eşiği aşılırsa mesaj bekletilir ve kısa bir şerit gösterilir ("Yine de gönder", düzenle, "Yerinde değildi"). Benzer olmayan mesajlara hiç dokunulmaz. Sohbet yeterince uzayıp tekrar görüldüğünde çıkış kartı önerilir; "Taze başlat" o ana kadarki isteklerden kısa bir özet taslağı çıkarır, panoya kopyalar ve yeni sohbet açar. Model halkası sonraki aşamada yalnızca ipucu olarak eklenecek (K07).

**Neden.** Bekletme yalnızca olmuş bir tekrara dayandığı için yanlış alarm riski düşüktür ve her uyarı gerekçesini taşır. Kullanıcı her an "Yine de gönder" ile devam edebilir; yasak ya da süre sınırı yoktur.

**Bedeli.** Anlamca aynı ama kelimece farklı mesajlar yakalanmaz (K03). Çıkış kartı yalnızca tur sayısı ve tekrar sayısına bakar, görev türünü bilmez.

**Değiştirildi (K17).** Eklenti artık bir tur modeliyle de çalışıyor; model yüksek güvenle döngü tahmin ettiğinde ve sohbette en az bir onarım ifadesi bulunduğunda çıkış kartını açabiliyor. Mesajın bekletilmesi (kesinti) hâlâ yalnızca benzer mesajda oluyor.

## K10. Siteler ortak bir adaptör arayüzüyle desteklenir; sayfa yapısı tanınmazsa eklenti sessizce devre dışı kalır

**Bağlam.** ChatGPT ve Gemini'nin sayfa yapıları farklı ve haber verilmeden değişebilir. Gemini'de `form` yoktur; mesaj kutusu `ql-editor`, gönderme çoğunlukla Enter iledir.

**Karar.** Sayfaya özgü her şey (mesaj kutusu, gönder düğmesi, üretim durumu, sohbet geçmişi, sohbet adresi) tek bir `Adapter` arayüzünün arkasındadır. Çekirdek, arayüz ve sayaçlar sitelerden bağımsızdır. Bir adaptör beklenen yapıyı bulamazsa eklenti hata göstermez, o sayfada kendini devre dışı bırakır. Gemini adaptörü gerçek sayfada ölçülen yapıya göre yazıldı ve canlı olarak sınandı: gönderme, tekrar uyarısı, sohbet geçişi, geçmişi okuma, çıkış kartı ve mesaj düzenleme.

**Neden.** Yeni site eklemek yalnızca yeni bir adaptör yazmak demektir. Sayfa değişirse kullanıcı bozuk bir ekranla değil, eklentisiz normal bir sayfayla karşılaşır.

**Bedeli.** Sayfa yapısı değiştikçe adaptörlerin bakımı gerekir. Henüz desteklenmeyenler: Gemini Gems sayfaları, çok uzun sohbetlerde tembel yüklenen geçmişin eksik sayılması ihtimali, Türkçe ve İngilizce dışındaki arayüz dilleri.

## K11. Mesaj metni yalnızca bellekte tutulur; eklentide ağ isteği yapan kod yoktur

**Bağlam.** Ürünün temel sözü mesajların cihazdan çıkmaması.

**Karar.** Mesaj metni yalnızca sekmenin belleğinde, o sekme açık kaldığı sürece durur. Hiçbir ağ isteği yapılmaz. Manifestteki içerik güvenlik politikası (`connect-src 'none'`) eklenti sayfalarında (araç çubuğu penceresi) ve arka plan çalışanında ağ isteğini tarayıcı düzeyinde engeller. İçerik betiği ise ChatGPT ya da Gemini sayfasının içinde, o sayfanın kurallarıyla çalışır; bu politika onu kapsamaz. İçerik betiği için güvence bir testten gelir: `extension/src/no-network.test.ts`, derlenmiş üç dosyada `fetch`, `XMLHttpRequest`, `WebSocket`, `sendBeacon`, `EventSource` ve `importScripts` adlarının hiç geçmediğini her test çalıştırmasında denetler. Konsola metin yazılmaz, yalnızca uzunluk ve benzerlik skoru yazılır. "Taze başlat" taslağı yalnızca kullanıcının tıklamasıyla panoya yazılır.

**Neden.** Gizlilik sözünü denetlenebilir kılmak: eklenti sayfalarında tarayıcının zorladığı bir kural, içerik betiğinde her derlemede çalışan bir test.

**Düzeltme notu.** Bu kararın ilk metni, `connect-src 'none'` kuralının içerik betiğini de kapsadığını söylüyordu; bu yanlıştı. Metin düzeltildi ve içerik betiği için yukarıdaki test eklendi.

**Bedeli.** Sekme kapanınca oturum bilgisi gider; eklenti geçmişi hatırlayamaz. Sohbet geçmişi sayfanın kendisinden okunur. Uzaktan hata raporu ya da kullanım analitiği yapılamaz.

## K12. Ayarlar araç çubuğu penceresinde, yalnızca Türkçe; saklanan tek veri iki ayar ve günlük sayaçlar

**Bağlam.** Kullanıcı eklentiyi kapatabilmeli, çıkış kartını kapatabilmeli ve eklentinin ne yaptığını görebilmeli.

**Karar.** Ayarlar araç çubuğu simgesinin penceresinde durur: "Eklenti açık" ve "Çıkış kartı" anahtarları, son 7 günün sayaçları ve "Tüm verilerimi sil". `chrome.storage.local` içinde yalnızca iki ayar ve günlük sayaçlar saklanır; sayaçlar 90 gün sonra silinir. Çıkış kartında "Bir daha gösterme", şeritte "Yerinde değildi" seçenekleri vardır; ikincisi yalnızca sayaca yansır ve mesaj metni kaydedilmez. Arayüz şimdilik yalnızca Türkçedir.

**Neden.** Kullanıcı eklenti üzerinde tam denetime sahip olur. Sayaçlar, eşiklerin gerçek kullanımda nasıl davrandığını görmemizi sağlar; "Yerinde değildi" sayısı yanlış alarm oranının en doğrudan ölçüsüdür.

**Bedeli.** Türkçe bilmeyen kullanıcılar için arayüz yetersiz. Sayaçlar yalnızca o tarayıcı profilinde durur, cihazlar arası birleştirilmez.

**Değiştirildi (K18).** Sayaçlar artık ayarlardan ayrı, şemalı ve boyutlu tutuluyor (`kafiai.counts.v2`). Saklanan veri yine yalnızca ayarlar ve sayılar; buna "Taze başlat" sonrası yeni sohbeti tanımak için on dakikalık bir işaret (yalnızca platform kimliği ve son geçerlilik zamanı) eklendi.

## K13. Çıkış kartı eşikleri geçicidir, WildChat ile kalibre edilecek

**Bağlam.** Çıkış kartı, tur sayısı ve tekrar sayısına göre açılıyor. Mevcut değerler (`EXIT_CARD_MIN_TURNS = 6`, `EXIT_CARD_MIN_REPEATS = 1`, `EXIT_CARD_COOLDOWN_TURNS = 5`) elle seçildi ve yalnızca birkaç canlı denemeyle sınandı.

**Karar.** Bu değerler geçici kabul edilir. Gerçek sohbet verisi (WildChat) üzerinde, görev türüne göre tur normları çıkarılarak ve çıkış kartının hangi sohbetlerde, hangi turda açılacağı simüle edilerek yeniden ayarlanacak. Kalibrasyon sonucu bu belgeye yeni bir karar olarak eklenecek ve bu karar "değiştirildi" notu alacak.

**Neden.** Elle seçilmiş bir sayıyı gerekçelendirmeden kalıcı kabul etmek, K06'nın "rapordaki sayılar ile koddaki değerler aynı yerden okunur" ilkesine aykırı olur.

**Bedeli.** Kalibrasyona kadar çıkış kartı bazı sohbetlerde erken, bazılarında geç çıkabilir.

**Değiştirildi.** Kalibrasyon yapıldı; yeni değerler ve gerekçeleri K14'te.

## K14. Eşikler WildChat ile kalibre edildi: şerit 0,8, yumuşak tekrar 0,6, çıkış kartı görev normuna göre

**Bağlam.** K13'teki geçici değerler gerçek sohbet verisiyle sınanmamıştı. Eklentinin benzerlik hesabı Python'a birebir aktarıldıktan sonra (`src/kafiai/extension_similarity.py`), eklentinin davranışı WildChat 1M örnekleminde, şablon sohbetler hariç 41.753 sohbet ve 55.483 karşılaştırılan gönderim üzerinde taklit edildi (`scripts/calibrate_extension.py`). Benzerlik aralıklarının her birinden mesaj çiftleri okunup "aynı talebin tekrarı mı" diye ön etiketlendi (80 çift, `outputs/threshold_labels_preliminary.json`).

**Bulgular.**

| Şerit eşiği | Şeridin çıktığı gönderim | Şeridin çıktığı çok turlu sohbet | Tahmini isabet |
|---|---|---|---|
| 0,6 (eski) | %28,1 | %39,9 | %59 |
| 0,7 | %20,5 | %31,8 | %74 |
| 0,8 (yeni) | %14,7 | %24,3 | %83 |
| 0,9 | %8,9 | %15,8 | %88 |

0,6 ile 0,8 arasındaki çiftlerin çoğu aynı talebin tekrarı değil; aynı işin yeni bir metne uygulanması ("şu paragrafı da çevir"), aynı konuda yeni bir soru ya da bir sonraki bölümün istenmesi. Bu aralıkta kullanıcıyı durdurmak, verdiğimiz her iki uyarıdan birinin yersiz olması demek.

Görev türüne göre çok turlu sohbetlerin uzunluğu birbirine yakın: ortanca 3 tur, %75'lik dilim 4 ile 6, %90'lık dilim 8 ile 10 tur. Eski kural (6. tur ve en az bir tekrar) çok turlu sohbetlerin %14,4'ünde kart açıyordu.

**Karar.**

1. Şerit eşiği 0,8: kullanıcı yalnızca neredeyse aynı mesajda durdurulur.
2. Yumuşak eşik 0,6: 0,6 ile 0,8 arasındaki mesajlar kullanıcıyı durdurmaz, yalnızca çıkış kartı için tekrar denemesi sayılır.
3. Çıkış kartı, sohbetin görev türündeki %90'lık dilimi aştığında (en az bir tekrar denemesiyle) açılır. Görev türü ilk mesajdan, Python ve eklentinin ortak okuduğu `extension/src/data/task-rules.json` kurallarıyla belirlenir; normlar `extension/src/data/task-norms.json` dosyasına kalibrasyon scriptiyle yazılır. Tür bilinmiyorsa sınır 9. turdur.
4. Kart metni normu söyler: "Kod yazma ve hata ayıklama sohbetlerinin çoğu 5 turda ya da daha kısa sürede bitiyor; bu sohbet 9. turunda."

Yeni kurallarla kart çok turlu sohbetlerin %6,9'unda, ortanca 9. turda açılıyor.

**Neden.** Durdurmak en pahalı müdahale; yalnızca isabetin yüksek olduğu yerde yapılmalı. Yumuşak eşik, farklı kelimelerle yapılan tekrarları tamamen kaybetmeden daha az müdahaleci olan çıkış kartına aktarır. Normlar, karttaki sayının elle seçilmiş değil, gerçek kullanımdan gelmesini sağlar.

**Bedeli.**

- Ön etiketler 80 çiftle ve bir dil modeliyle yapıldı; isabet tahminleri kaba. Ekip `data/processed/labeling/threshold_pairs.csv` dosyasındaki çiftleri elle etiketleyip scripti yeniden çalıştırmalı.
- Görev türü kuralları basit; çok turlu sohbetlerin yaklaşık %70'i "diğer" türüne düşüyor, bu sohbetlerde kart normsuz cümleyi kullanıyor.
- Normlar 2023 ile 2024 ChatGPT verisinden; WildChat 4.8M ile yeniden hesaplanmalı.

## K15. Etiketin ikinci sürümü: benzerlik değil güçlü onarım ifadeleri esas alınır

**Bağlam.** K02'deki ilk etiket, ilk iki turdan sonra en az 2 benzer mesaj ya da en az 2 onarım ifadesi görülen sohbetleri döngü sayıyordu. WildFeedback'teki memnuniyetsizlik (DSAT) işaretleriyle karşılaştırıldığında bu etiketin işaretlediği sohbetlerde memnuniyetsizlik oranı genel orandan neredeyse farksız çıktı (1,09 kat). Benzer mesajların çoğu "AA için listele, AB için listele" gibi verimli seri işlerdi.

**Karar.** Yeni etikette (`labels.loop_label`) bir sohbet şu durumda döngü sayılır: ilk iki turdan sonra en az 2 güçlü onarım ifadesi, ya da 1 güçlü onarım ifadesi ile birlikte 1 birebir yeniden gönderim (benzerlik 0,97 üstü). Güçlü onarım listesi (`text.STRONG_REPAIR_PATTERNS`) yalnızca WildFeedback'te memnuniyetsizliği en az 2 kat artıran ifadelerden oluşur. İlk etiket karşılaştırma için tablolarda `label_v1` olarak tutulur.

**Neden.** Yeni etiket memnuniyetsizliği 2,87 kat daha sık gösteriyor. Kural, WildFeedback'in yarısına bakılarak seçildi ve hiç bakılmayan öbür yarıda aynı sonucu verdi (`outputs/label_validation.json`, docs/08 Bölüm 5.1).

**Bedeli.** Pozitif oranı %10'dan %7'ye düştü, yani modelin öğreneceği örnek azaldı. Türkçe onarım ifadeleri WildFeedback İngilizce olduğu için henüz doğrulanmadı. Ürün açısından da bir sonucu var: 0,6 ile 0,8 arasındaki yumuşak tekrarlar (K14) tek başına memnuniyetsizlik göstermiyor; çıkış kartının tekrar sayımı ileride onarım ifadeleriyle birleştirilmeli.

## K16. Model WildChat 4.8M ile eğitilir; eklenti için 25 öznitelikli Logistic Regression seçilir

**Bağlam.** İlk denemedeki model 1M örnekleminden çıkan 8.094 sohbetle eğitilmişti ve tek bir eğitim/test bölmesiyle ölçülmüştü. K08, eğitim verisinin WildChat 4.8M olmasını öngörüyordu.

**Karar.** WildChat 4.8M'in 86 dosyasından zamana yayılmış 10'u indirildi; bu dosyalardaki tüm çok turlu sohbetler temizlendikten sonra 28.123 sohbetlik eğitim tablosu oluştu. Öznitelik sayısı 11'den 25'e çıkarıldı (görev türü, eklenti benzerliği, ikinci mesajda güçlü onarım, uzunluklar). Beş yöntem kullanıcı bazlı 5 katlı çapraz doğrulama ve hiperparametre aramasıyla karşılaştırıldı (`scripts/train_models.py`). Eklenti için 25 öznitelikli Logistic Regression seçildi; katsayıları `outputs/logreg_model.json` dosyasında.

**Neden.** 25 öznitelikli model aynı model türünde CV PR-AUC'yi 0,195'ten 0,245'e çıkardı. Karakter n-gram eklenen model ana testte %16 daha iyi, ama Türkçe testte geride kalıyor, 65.536 ağırlık taşıyor ve uyarının gerekçesini açıklamak zorlaşıyor. Seçilen model eğitimde görmediği WildChat 1M'de rastgelenin 4,7, Türkçede 2,4 katı; bizim etiketimizden bağımsız DSAT işaretlerinde de 1,6 katı.

**Bedeli.** Model döngü dediğinde yaklaşık 4 seferden 1'inde haklı; bu yüzden eklentide engel değil, yüksek eşikli yumuşak bir öneri olarak kullanılmalı. Olasılıklar kalibre değil; kullanıcıya yüzde olarak gösterilmemeli.

**Değiştirildi.** Eklentiye giren model K17'deki tur modeli oldu; bu modelin öznitelikleri tarayıcıya taşınabilecek şekilde yeniden seçildi.

## K17. Eklentide her mesajda çalışan, kalibre edilmiş tur modeli; kart yalnızca yüksek güven ve kanıt şartıyla

**Bağlam.** K16'daki model yalnızca ilk iki mesajı görüyordu, olasılıkları kalibre değildi ve bazı öznitelikleri (sklearn'ün karakter n-gram benzerliği) tarayıcıya taşınamıyordu. Oysa döngünün en güçlü işareti olan onarım ifadeleri çoğunlukla 3. mesajdan sonra geliyor.

**Karar.** Model her sohbetten k = 2 ile 6 arası turlar için örnek alınarak yeniden eğitildi; 22 öznitelik eklentide birebir aynı hesaplanıyor (`turn_features.py`, `turn-features.ts`). Güçlü onarım kuralları ortak bir JSON dosyasına taşındı. Olasılıklar Platt ölçekleme ile kalibre edildi. Çıkış kartı, görev normuna ek olarak modelin yüksek güven eşiğini (kesinlik en az %40 olacak şekilde eğitim verisinden seçildi) geçtiği ve sohbette en az bir güçlü onarım ifadesi bulunduğu turda açılabiliyor. Kart, en çok katkı yapan özniteliğe göre bir gerekçe ve somut bir öneri gösteriyor; "Yerinde değildi" geri bildirimi yalnızca sayı olarak tutuluyor. Ayrıntılar: docs/09.

**Neden.** Aynı test kullanıcılarında 2. turda PR-AUC 0,199'dan 0,213'e çıktı, 6. turda 0,364'e (rastgelenin 4,7 katı) ulaştı. Kalibrasyon hatası (ECE) 0,337'den 0,013'e indi. Kanıt şartı kartın isabetini %33'ten %38'e çıkardı, yakalanan döngü oranını yalnızca 1,6 puan düşürdü.

**Bedeli.** Kart açıldığında yaklaşık 8 seferden 5'inde sohbet döngüye girmiyor; bu yüzden kart engellemiyor, kapatılabiliyor ve bekleme süresine uyuyor. Model asistanın cevaplarını görmüyor. Türkçe onarım ifadeleri henüz elle doğrulanmadı.

## K18. Sayaç şeması v2: günlük, seyrek, boyutlu ve yalnızca sayı; ortak JSON şemasıyla doğrulanır

**Bağlam.** İlk sayaçlar (K12) günde 19 sabit sayıdan oluşuyordu. Haftalık içgörü (P3), çok platformlu pilot (P7) ve mikro randomize deney için şunları ayırabilmek gerekiyor: hangi platformda, günün hangi diliminde, hangi işte, sohbetin kaçıncı turunda; bir önerinin tetiklendiği ama gösterilmediği durumlar ve nedeni; sohbetlerin sonucu. Bunu yaparken gizlilik sözü (K11) değişmemeli.

**Karar.**
- Sayaçlar `chrome.storage.local` içinde `kafiai.counts.v2` anahtarında, günlük ve 90 gün saklanır. Her gün bir faz (sayım, öneri ya da karışık) ve yalnızca sıfır olmayan hücrelerden oluşur.
- Hücre anahtarı `olay|boyut1|...|ayrıntı`. Boyutlar: platform, saat dilimi (00–06, 06–12, 12–18, 18–24), görev türü, tur kovası (1–3, 4–6, 7–10, 11+), ilk mesaj uzunluğu kovası (80 ve 400 karakter sınırları). Olaylar: gönderim, şerit, şerit eylemleri, onarım düğmesi (türüyle), çıkış kartı (norm ya da model kaynaklı; tetiklendi, gösterildi, gizlendi ve nedeni), kart eylemleri, "Taze başlat" sonrası yeni sohbetin tur kovası, yeniden üretme, düzenleme ve sohbet sonucu (döngü ya da normal).
- Şema tek bir JSON dosyasında (`extension/src/data/counter-schema.json`). Eklenti (`src/core/counters.ts`) ve Python (`src/kafiai/counters.py`) aynı dosyayla doğrular; şemaya uymayan her hücre okunurken atılır.
- Yazmalar birikir ve iki saniyede bir, sekme arka plana geçince ya da kapanırken tek seferde yazılır.
- Sürüm 1 sayaçları ilk okumada bir kez v2'ye taşınır (boyutlar "na") ve eski anahtar silinir.
- "Sayaçlarımı kopyala" çıktısı sürüm numaralıdır: `{"schema": "kafiai.counts", "version": 2, "exported": "YYYY-MM-DD", "days": {...}}`.
- "Taze başlat"a basılınca yeni sohbeti tanımak için `kafiai.pending_fresh` anahtarına yalnızca platform kimliği ve on dakikalık son geçerlilik zamanı yazılır; yeni sohbet açılınca okunur ve hemen silinir.

**Neden.** Boyutlar, P3'teki "döngüler ne zaman, hangi işte, hangi platformda" sorularını ve P7'deki iki fazlı karşılaştırmayı mümkün kılıyor. Gizlilik yapısal olarak korunuyor: boyut değerleri şemadaki kısa ve sabit sözcük listelerinden geliyor, başka bir değer kabul edilmiyor; mesaj metni, sohbet kimliği ya da adres anahtara girecek bir yol bulamıyor. Bunu bir test sınıyor: rastgele mesajlarla kullanım benzetiminden sonra depoda hiçbir mesaj kelimesi, adres ya da kimlik bulunmuyor ve tüm anahtarlar izinli listeden geliyor (`counters.test.ts`).

**Boyut.** Günde 300 olayla 90 günlük yoğun kullanım benzetiminde depolanan veri 1,5 MB'ın altında kalıyor (test). `chrome.storage.local` sınırı 10 MB.

**Bedeli.** Hücre sayısı boyutların çarpımıyla büyüyebilir; seyrek saklama ve 90 günlük süre bunu sınırlıyor. Sohbet sonucu yalnızca kullanıcının o ziyarette en az bir mesaj gönderdiği sohbetler için ve sohbetten ayrılırken bir kez sayılıyor; aynı sohbete başka bir gün dönülürse ikinci kez sayılabilir. Sürüm 1'den taşınan sayıların boyutları bilinmiyor.

## K19. Platform kaydı: desteklenen siteler ve yetenekleri tek yapılandırma dosyasında

**Bağlam.** Sırada Claude, Copilot ve Google AI Modu var (P5). Her platform aynı yeteneklere sahip değil (yeniden üretme ve düzenlemeyi yakalayabilmek gibi) ve P4'ün sonucuna göre bir platformda modelin kapatılması ya da yalnızca sayım yapılması gerekebilir.

**Karar.** Desteklenen siteler `extension/src/data/platforms.json` dosyasında tek listede durur: her platformun içerik betiğinin çalıştığı adresler ve yetenekleri (`regenerate`, `edit`, `model: on | off`, `interventions: full | count_only`). Adaptör arayüzü platform kimliği ve isteğe bağlı `onRegenerate`, `onEdit` olaylarıyla genişledi. İçerik betiği adaptörü bu kayıttan seçer; model kapalıysa tahmin yapılmaz, `count_only` ise şerit ve kart gösterilmez, yalnızca "gizlendi_platform" olarak sayılır. Manifestteki içerik betiği adresleri ve site izinleri kayıtla birebir aynı olmak zorunda; `registry.test.ts` bunu denetler.

**Neden.** Yeni bir platformu eklemek ya da bir platformda modeli kapatmak kod değil yapılandırma değişikliği olur ve tek yerden izlenir. Manifest ile kaydın ayrışması (yeni bir sitede betiğin çalışıp adaptörün bulunamaması ya da tersi) test aşamasında yakalanır.

**Bedeli.** Platform başına yalnızca açma, kapama ve sayım ayarı var; tüm platformlar aynı modeli kullanıyor; platforma özel model yok.

