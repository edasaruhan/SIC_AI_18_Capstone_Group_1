# Bölüm 2: Veri Araştırması

**Proje:** Üretken yapay zeka kullanımında aşırı güven ve verimsiz kullanım döngülerinin tespiti
**Grup:** SIC AI 18 Capstone, Grup 1
**Analiz kodu:** [`scripts/run_eda.py`](../scripts/run_eda.py) · **Sayısal özet:** [`outputs/eda_summary.json`](../outputs/eda_summary.json)

> **Güncelleme notu.** Bu bölüm projenin ilk keşif analizidir ve olduğu gibi korunuyor. Üç bulgu sonradan daha sıkı bir yöntemle yeniden hesaplandı; güncel sayılar [`outputs/findings.json`](../outputs/findings.json) ve README'de:
> (1) Tekrar oranı (%31,6) boş ve 12 karakterden kısa mesajları ve şablonları da sayıyordu; eklentinin benzerlik hesabıyla ve bu ayrımlarla oran %24,9. Ayrıca benzer mesajın tek başına memnuniyetsizlik göstermediği görüldü ([Bölüm 8](08_data_preparation_and_model.md), Bölüm 5.1).
> (2) Gece kullanımı şablonlar çıkarılınca ve kullanıcı ağırlıklı bakılınca %18,0 (%95 güven aralığı %12,9 ile %23,1); saatler eşit dağılsaydı bu 6 saatin payı %25 olurdu, yani gece öne çıkmıyor.
> (3) Uzun sohbetlerdeki memnuniyetsizlik artışı (yaklaşık 7 kat) sohbet başına hesaplanmıştı; mesaj başına artış yaklaşık 2 kat.

---

## 1. Giriş

### 1.1 Verinin cevaplamasını beklediğimiz sorular

Bölüm 1'de literatürün büyük kısmının anket ve öz bildirime dayandığını, gerçek kullanım davranışına bakan çalışmaların ise ya kamuya açık olmayan veri kullandığını ya da farklı bir soruya odaklandığını gördük. Bu bölümde gerçek yapay zeka sohbetlerinden oluşan açık veri setlerini inceleyerek beş soruya cevap arıyoruz:

| # | Araştırma sorusu | Projedeki karşılığı |
|---|---|---|
| AS1 | Yapay zeka sohbetlerinde aynı talebin tekrar tekrar gönderildiği **döngüler** gerçekten görülüyor mu, ne sıklıkla? | Modelin tespit edeceği ana örüntü |
| AS2 | Kullanım az sayıda **yoğun kullanıcıda** toplanıyor mu? | Risk grubunun tanımı |
| AS3 | Türkiye'den gelen kullanımın **zaman örüntüsü** nasıl, gece kullanımı ne düzeyde? | Hedef grubun bağlamı |
| AS4 | Kullanıcılar ilk mesajda **doğrudan üretim mi** yoksa **anlama mı** istiyor? | Düşünme devri göstergesi |
| AS5 | Bir etkileşimin iyi ya da kötü gittiğini gösteren **hazır etiketler** var mı? | Model eğitimi için etiket kaynağı |

### 1.2 Neden kapsamlı bir veri keşfi gerekli?

Projemizin çekirdeği, "verimsiz döngü" gibi henüz tanımlanmamış bir davranışı veriden öğrenecek bir model. Model eğitmeden önce üç şeyi bilmemiz gerekiyor: aradığımız örüntü veride gerçekten var mı, ne kadar sık görülüyor ve veride bu örüntüyü bozabilecek gürültü (otomatik gönderilen istekler, çok kısa mesajlar, dil dengesizliği) ne düzeyde. Bu sorulara cevap vermeden kurulan bir model, var olmayan bir sinyali öğrenmeye ya da gürültüyü sinyal sanmaya çok açık olur.

---

## 2. Düzen

Bulguları veri setine ve temaya göre sıraladık:

1. **Veri tanımı:** Üç veri setinin kaynağı, formatı, boyutu ve lisansı.
2. **Etik ve gizlilik:** Veri setlerinin kendi önlemleri, bizim analizde aldığımız önlemler ve ileride kendi verimizi toplarsak uyacağımız kurallar.
3. **Analiz ve bulgular:** Önce WildChat örneklemi için genel görünüm, ardından araştırma sorularına karşılık gelen sırayla kullanım yoğunluğu, zaman örüntüsü, döngüler, ilk talebin türü ve son olarak OASST1 etiketleri.
4. **Veri kalitesi:** Karşılaştığımız sorunlar ve bunları nasıl ele alacağımız.

Her grafiğin altında, konuya yabancı bir okuyucunun da anlayabileceği şekilde **"Ne görüyoruz?"** ve **"Projemiz için anlamı"** başlıklı kısa yorumlar bulunuyor.

---

## 3. Veri Tanımı

### 3.1 Kullandığımız veri setleri

| | WildChat 1M | LMSYS Chat 1M | OpenAssistant OASST1 |
|---|---|---|---|
| **Rolü** | Ana veri seti | Genelleme testi | Etiket referansı |
| **Kaynak** | [Hugging Face, allenai](https://huggingface.co/datasets/allenai/WildChat-1M) | [Hugging Face, lmsys](https://huggingface.co/datasets/lmsys/lmsys-chat-1m) | [Hugging Face, OpenAssistant](https://huggingface.co/datasets/OpenAssistant/oasst1) |
| **İçerik** | Gerçek kullanıcıların ChatGPT (GPT 3.5 ve GPT 4) ile yaptığı sohbetler | Gerçek kullanıcıların 25 farklı dil modeliyle yaptığı sohbetler | Gönüllülerin yazdığı soru cevap ağaçları ve insanların verdiği kalite puanları |
| **Boyut** | Yaklaşık 838 bin sohbet | 1 milyon sohbet, 210 bin kullanıcı | Yaklaşık 88 bin mesaj |
| **Zaman aralığı** | Nisan 2023 ile Nisan 2024 arası | Nisan ile Ağustos 2023 arası | 2023 |
| **Dil** | 68 dil | 154 dil | 35 dil |
| **Format** | Parquet; her satır bir sohbet, mesajlar liste halinde | Parquet; her satır bir sohbet | Parquet; her satır bir mesaj, ağaç yapısı `parent_id` ile kurulur |
| **Nasıl toplandı?** | Araştırmacıların ücretsiz sunduğu bir ChatGPT arayüzünü kullanan ve verilerinin paylaşılmasına onay veren kullanıcılardan | Vicuna demo ve Chatbot Arena platformlarının kullanıcılarından | Gönüllülerin topluluk katkısıyla |
| **Lisans** | ODC BY, açık erişim | LMSYS Chat 1M lisans sözleşmesi; yeniden dağıtım ve kişi tespiti yasak | Apache 2.0, açık erişim |

### 3.2 Neden bu veri setleri?

**WildChat 1M** projemiz için en uygun ana veri seti. Üç özelliği onu benzersiz kılıyor:
1. **Gerçek ve çok turlu sohbetler** içeriyor, böylece bir sohbetin nasıl ilerlediğini, nerede tıkandığını görebiliyoruz.
2. **Zaman damgası** sayesinde kullanımın günün hangi saatinde yoğunlaştığını inceleyebiliyoruz.
3. **Şifrelenmiş IP adresi** (`hashed_ip`) sayesinde aynı kaynaktan gelen sohbetleri gruplayıp kullanıcı düzeyinde yoğunluğa bakabiliyoruz. Bu, Bölüm 1'de vurguladığımız "kişinin kendi normali" fikrinin veri üzerinde sınanabilmesini sağlıyor.

**LMSYS Chat 1M**, bulgularımızın yalnızca ChatGPT'ye özgü olup olmadığını test etmek için kullanılacak. Lisans sözleşmesinin onaylanması gerektiğinden bu aşamada analize dahil etmedik; model geliştirme aşamasında genelleme testi olarak kullanılacak.

**OpenAssistant OASST1**, WildChat'te bulunmayan bir şeyi sunuyor: insanların cevapları "kalite", "yardımseverlik", "görevi yerine getirmedi" gibi ölçütlerle puanladığı etiketler. Bu etiketler, ileride "iyi giden" ve "kötü giden" etkileşimleri ayıran modelimiz için referans noktası olacak.

### 3.3 Analizde kullandığımız örneklem

WildChat'in tamamını indirmek yerine Hugging Face Datasets kütüphanesinin `streaming` modu ile veriyi akış halinde okuyup sabit bir rastgelelik tohumu (`seed = 42`) ile karıştırarak **50.000 sohbetlik** bir örneklem aldık. Aynı komut her çalıştırıldığında aynı örneklem elde edildiği için analiz tekrarlanabilir. OASST1'den ise ilk 30.000 mesaj okundu.

| Özellik | Değer |
|---|---|
| Sohbet sayısı | 50.000 |
| Farklı kullanıcı (şifrelenmiş IP) | 16.809 |
| Zaman aralığı | 9 Nisan 2023 ile 5 Nisan 2024 arası |
| Dil sayısı | 68 |
| Ülke sayısı | 157 |
| En sık kullanılan model | gpt-3.5-turbo-0613 (%40,4) |
| Eksik değer | Yalnızca `country` alanında %0,1 |

Veri minimizasyonu ilkesi gereği her sohbetten yalnızca analizde kullandığımız alanları çıkardık: zaman damgası, model, dil, ülke, şifrelenmiş IP, kullanıcı mesajları ve mesaj uzunlukları. Yapay zekanın cevaplarının yalnızca uzunluğunu sakladık.

---

## 4. Etik ve Veri Gizliliği

### 4.1 Veri setlerinin kendi önlemleri

* **WildChat 1M:** Kullanıcılar verilerinin araştırma amacıyla paylaşılmasına onay vermiştir. IP adresleri SHA-256 ile şifrelenmiş, kişisel bilgi içeren sohbetler ayıklanmış ve toksik içerikli sohbetler bu sürümden çıkarılmıştır.
* **LMSYS Chat 1M:** Kişisel bilgiler maskelenmiştir. Lisans sözleşmesi, veri setinin üçüncü kişilerle paylaşılmasını ve kişilerin kimliğinin tespit edilmeye çalışılmasını açıkça yasaklar.
* **OASST1:** Gönüllüler tarafından araştırma amacıyla yazılmış içeriklerden oluşur.

### 4.2 Bizim analizde aldığımız önlemler

1. **Ham veri repoya girmez.** İndirilen örneklem yalnızca yerel bilgisayarda `data/processed/` klasöründe tutulur ve `.gitignore` ile repo dışında bırakılır.
2. **Yalnızca toplu sonuçlar paylaşılır.** Raporda ve `outputs/eda_summary.json` dosyasında tek bir kişiye ait mesaj, örnek sohbet veya şifrelenmiş IP yer almaz; yalnızca oranlar ve dağılımlar bulunur.
3. **Kişi tespiti yapılmaz.** Şifrelenmiş IP yalnızca sohbetleri gruplamak için kullanılır; hiçbir kişiyi tanımlamaya yönelik işlem yapılmaz.
4. **Veri minimizasyonu.** Analiz için gerekmeyen alanlar (tarayıcı bilgisi, eyalet, moderasyon puanlarının ayrıntısı) hiç işlenmez.

### 4.3 İleride kendi verimizi toplarsak: KVKK uyumu

Ürünü bir kullanıcı çalışmasıyla test etmeyi planlıyoruz. Bu durumda 6698 sayılı Kişisel Verilerin Korunması Kanunu kapsamında şu adımları izleyeceğiz:

| İlke | Uygulama |
|---|---|
| **Aydınlatma ve açık rıza** | Katılımcılara hangi verinin, hangi amaçla, ne kadar süre tutulacağını anlatan bir aydınlatma metni sunulur ve yazılı açık rıza alınır. |
| **Reşit olmayanlar** | Hedef grubumuz 18 ile 30 yaş arası olduğu için 18 yaşından küçükler çalışmaya dahil edilmez. |
| **Veri minimizasyonu** | Mesaj içerikleri saklanmaz; yalnızca cihaz içinde hesaplanan özet göstergeler (döngü sayısı, oturum süresi) toplanır. |
| **Anonimleştirme** | Katılımcılar rastgele bir kimlik numarasıyla takip edilir; isim ve iletişim bilgisi analiz verisinden ayrı tutulur. |
| **Güvenli saklama** | Veriler şifreli bir ortamda, yalnızca proje ekibinin erişebileceği şekilde saklanır ve çalışma bitince silinir. |
| **Silme hakkı** | Katılımcı istediği an çalışmadan çıkabilir ve verisinin silinmesini isteyebilir. |

Bu aşamadaki analizde kişisel veri toplamadık; yalnızca kamuya açık ve anonimleştirilmiş veri setlerini kullandık.

---

## 5. Veri Analizi ve Bulgular

### 5.1 Genel görünüm: dil ve ülke dağılımı

![Dil ve ülke dağılımı](../figures/01_language_country.png)

**Ne görüyoruz?** Sohbetlerin yarıdan fazlası (%54,0) İngilizce. Onu Çince (%19,9) ve Rusça (%9,0) izliyor. Ülke bazında ilk sırada ABD (%21,3), ardından Çin (%13,6) ve Rusya (%11,7) geliyor. Türkiye'den gelen sohbet sayısı **691**, yani örneklemin **%1,4**'ü. Türkçe yazılmış sohbet sayısı ise **402**.

**Projemiz için anlamı:** Veri seti çok dilli ve küresel. Bu, modelimizin farklı dillerdeki döngüleri öğrenmesi için iyi bir zemin. Ancak Türkçe veri sınırlı. Bu yüzden çok dilli bir model kullanmamız gerekiyor ve Türkçe performansı ayrıca test edilmeli.

### 5.2 Sohbet uzunluğu

![Sohbet uzunluğu dağılımı](../figures/02_turn_distribution.png)

**Ne görüyoruz?** Sohbetlerin **%61,5**'i tek bir soru ve cevaptan oluşuyor; ortanca sohbet uzunluğu 1 tur. Buna karşılık sohbetlerin **%11,8**'i 5 tur veya daha uzun, **%2,9**'u ise 10 tur veya daha uzun. En uzun sohbet 110 tur sürmüş. Dikey eksen logaritmik olduğu için grafikte uzun sohbetlerin oluşturduğu "uzun kuyruk" belirgin şekilde görülüyor.

**Projemiz için anlamı:** Kullanımın büyük kısmı kısa ve tek seferlik. Döngü riski taşıyan sohbetler ise bu uzun kuyrukta yer alıyor. Modelimizin odaklanması gereken kesim, toplam sohbetlerin küçük ama önemli bir kısmını oluşturan bu uzun sohbetler.

### 5.3 Kullanım yoğunluğu (AS2)

![Kullanıcı başına sohbet ve yoğunlaşma eğrisi](../figures/04_user_concentration.png)

**Ne görüyoruz?** Kullanıcıların **%61,2**'si örneklemde yalnızca bir kez görünüyor. Buna karşılık kullanımın büyük kısmı az sayıda kullanıcıda toplanmış: **en yoğun %1'lik kullanıcı grubu sohbetlerin %28,0'ını, en yoğun %10'luk grup ise %54,1'ini** oluşturuyor. Sağdaki eğri, kullanım eşit dağılsaydı kesikli çizgiyle çakışacaktı; aradaki büyük açıklık güçlü bir yoğunlaşmayı gösteriyor.

**Projemiz için anlamı:** Bu bulgu Phang vd. (2025)'nin ChatGPT verisinde gözlediği, yoğun kullanımın küçük bir grupta toplanması örüntüsüyle örtüşüyor. Ancak bir uyarı gerekiyor: şifrelenmiş IP bir kişiyi değil bir ağ bağlantısını temsil ediyor ve en yoğun "kullanıcıların" bir kısmı otomatik isteklerden oluşuyor olabilir. Bunu bir sonraki grafikte inceledik.

![Şablon sohbetlerin kullanıcı gruplarına göre dağılımı](../figures/09_templates_by_user_group.png)

**Ne görüyoruz?** İlk mesajı örneklemde 20 kez veya daha fazla birebir tekrarlanan sohbetleri **şablon (otomatik)** sohbet olarak işaretledik. Bunlar genellikle bir program aracılığıyla aynı hazır komutla gönderilen isteklerdir. Örneklemin **%16,5**'i bu tanıma uyuyor ve 72 farklı şablondan oluşuyor. En yoğun %1'lik kullanıcıların sohbetlerinde şablon oranı **%28,9**, diğer kullanıcılarda ise **%11,7**.

**Projemiz için anlamı:** En yoğun kullanıcılarda otomatik kullanım yaklaşık 2,5 kat daha fazla. Yani yoğunlaşmanın bir kısmı gerçekten programlar tarafından gönderilen isteklerden kaynaklanıyor. Ancak en yoğun kullanıcıların sohbetlerinin yaklaşık %71'i şablon değil; bu da yoğun kullanımın büyük ölçüde gerçek kişilerden geldiğini gösteriyor. Model eğitiminde şablon sohbetleri ayıklayacağız, aksi halde model bir kişinin davranışını değil bir programın davranışını öğrenebilir.

### 5.4 Zaman örüntüsü ve gece kullanımı (AS3)

![Saatlere göre kullanım](../figures/03_hour_of_day.png)

**Ne görüyoruz?** Soldaki grafik tüm sohbetlerin UTC saatine göre dağılımını gösteriyor. Ülkeler farklı saat dilimlerinde olduğu için bu grafik genel bir fikir veriyor; zirve UTC 08:00 civarında. Sağdaki grafikte ise Türkiye'den gelen sohbetleri yerel saate (UTC+3) çevirdik. Birkaç yoğun kullanıcının dağılımı çarpıtmaması için her kullanıcıya eşit ağırlık verdik (214 kullanıcı). Bu hesapla Türkiye'deki kullanımın **%17,5**'i gece 00:00 ile 05:59 arasında gerçekleşiyor; en yoğun saat **18:00**. Ağırlıklandırma yapılmadan, sohbet sayısı üzerinden bakıldığında bu oran %30,7.

**Projemiz için anlamı:** Ağırlıklandırma yapılmadan bakıldığında gece kullanımı %30,7 iken her kullanıcıya eşit ağırlık verildiğinde %17,5'e düşüyor. Bu fark çok önemli: gece kullanımının önemli bir kısmı az sayıda yoğun kullanıcıdan geliyor. Ortalama bir kullanıcı yapay zekayı daha çok gün içinde, öğleden sonra ve akşam saatlerinde kullanırken, gece saatlerindeki yoğun kullanım belirli bir grupta toplanıyor. Bu, Bölüm 1'deki "risk kullanım süresinden çok yoğunluk ve biçimle ilgili" bulgusuyla örtüşüyor ve eklentinin gece saatlerinde kişinin kendi örüntüsünden sapmasını ayrıca dikkate alması gerektiğini gösteriyor. Not: Türkiye örneklemi 214 kullanıcıyla sınırlı olduğu için bu sonuçlar ilk bulgu niteliğinde.

### 5.5 Verimsiz döngüler (AS1)

![Ardışık kullanıcı mesajları arasındaki benzerlik](../figures/05_consecutive_similarity.png)

Bu analizde en az 3 kullanıcı mesajı içeren 10.000 sohbet seçip art arda gelen her mesaj çiftinin birbirine ne kadar benzediğini ölçtük (toplam 48.427 çift). Benzerliği ölçmek için mesajları, anlamlarına göre sayısal vektörlere çeviren çok dilli bir dil modeli (`paraphrase-multilingual-MiniLM-L12-v2`) kullandık. Benzerlik puanı 1'e yaklaştıkça iki mesaj birbirinin neredeyse aynısıdır.

**Ne görüyoruz?** Mesaj çiftlerinin çoğu 0,2 ile 0,6 arasında, yani kullanıcılar genellikle sohbeti farklı yönlere taşıyor. Ancak dağılımın sağ ucunda, **1,0'da belirgin bir tepe** var: bu çiftlerde kullanıcı neredeyse aynı mesajı tekrar göndermiş (çiftlerin %4,0'i 0,98 ve üzerinde). 0,85 eşiğini "neredeyse aynı talep" olarak kabul ettiğimizde:

| Gösterge | Değer |
|---|---|
| Eşiğin üzerindeki mesaj çiftleri | %11,7 |
| En az bir kez neredeyse aynı mesajın tekrarlandığı sohbetler | **%31,6** |
| Şablon sohbetler çıkarıldığında aynı oran | **%31,8** |
| Mesaj çiftlerinin en az yarısının tekrar olduğu sohbetler | %13,0 |

![Sohbet uzunluğuna göre tekrar oranı](../figures/10_repeat_by_length.png)

**Ne görüyoruz?** Sohbet uzadıkça en az bir tekrar içerme olasılığı artıyor: 3 ile 4 turluk sohbetlerde **%25,1**, 5 ile 9 turluk sohbetlerde **%35,9**, 10 tur ve üzeri sohbetlerde **%47,5**.

**Projemiz için anlamı:** Bu, projenin temel varsayımının veriyle desteklendiğini gösteren en önemli bulgu. Çok turlu sohbetlerin yaklaşık üçte birinde kullanıcı en az bir kez aynı talebi neredeyse aynı şekilde tekrar gönderiyor ve bu örüntü sohbet uzadıkça belirginleşiyor. Benzerlik puanı, modelimizin en güçlü girdilerinden biri olacak.

### 5.6 Memnuniyetsizlik ve onarım ifadeleri

![Onarım ifadeleri](../figures/06_repair_by_length.png)

Kullanıcının ilk mesajdan sonraki mesajlarında "yanlış", "olmadı", "try again", "that's not what I asked" gibi ifadeleri İngilizce ve Türkçe bir sözlükle aradık.

**Ne görüyoruz?** Bu ifadeler çok turlu sohbetlerin yalnızca **%1,8**'inde geçiyor. Ancak oran sohbet uzunluğuyla birlikte hızla artıyor: 2 turluk sohbetlerde %0,8 iken 10 tur ve üzeri sohbetlerde **%5,6**, yani yaklaşık **7 kat**.

**Projemiz için anlamı:** Kullanıcılar memnuniyetsizliklerini nadiren açıkça dile getiriyor; çoğu zaman sadece soruyu yeniden soruyor. Bu, sözlük tabanlı bir yaklaşımın tek başına yetersiz olduğunu ve anlam benzerliğine dayanan döngü tespitinin neden gerekli olduğunu gösteriyor. Yine de onarım ifadeleri, uzun sohbetlerde modelimiz için güçlü bir ek sinyal.

### 5.7 İlk talebin türü (AS4)

![İlk talebin türü](../figures/07_first_prompt_intent.png)

Her sohbetin ilk mesajını basit kurallarla dört gruba ayırdık: "yaz, çöz, oluştur, çevir" gibi **doğrudan üretim** talepleri; "açıkla, neden, nasıl" veya soru işaretiyle biten **anlama ve soru** talepleri; bu ikisine uymayan **diğer** mesajlar ve **şablon** sohbetler.

**Ne görüyoruz?** Tüm örneklemde ilk taleplerin dağılımı şöyle: doğrudan üretim **%16,0**, anlama ve soru **%9,2**, diğer **%58,4**, şablon **%16,5**. Türkiye'de doğrudan üretim oranı **%14,8**, anlama ve soru oranı **%13,3**; diğer ülkelerde bu oranlar sırasıyla %16,0 ve %9,1.

**Projemiz için anlamı:** Sınıflandırılabilen taleplerde doğrudan üretim talepleri anlama taleplerinin yaklaşık 1,7 katı. Yani kullanıcılar yapay zekadan bir şeyi açıklamasından çok bir şeyi kendileri yerine yapmasını istiyor. Türkiye'de anlama ve soru oranı görece daha yüksek, ancak Türkiye örneklemi küçük olduğu için bu farkı kesin bir bulgu olarak değil, ileride test edilecek bir gözlem olarak değerlendiriyoruz. Taleplerin yarıdan fazlasının "Diğer" grubunda kalması ise kural tabanlı yaklaşımın sınırını gösteriyor: rol yapma istekleri, yapıştırılmış metinler veya bağlamsız kısa mesajlar bu kurallarla sınıflandırılamıyor. Kural tabanlı sınıflandırmanın sınırları açıkça görülüyor; bu nedenle bir sonraki aşamada bu sınıflandırmayı etiketli veriyle eğitilmiş bir modelle değiştireceğiz.

### 5.8 OASST1: insan kalite puanları (AS5)

![OASST1 etiketleri](../figures/08_oasst_labels.png)

**Ne görüyoruz?** Okunan 30.000 mesajın 18.990'ı asistan cevabı ve bunların **%97 ile %98**'i insanlar tarafından puanlanmış. Ortalama kalite puanı 0,66, yardımseverlik 0,68. Cevapların **%10,3**'ü ortalamada "görevi yerine getirmedi" olarak işaretlenmiş ve **%8,7**'sinin kalite puanı 0,3'ün altında. Veri setinde İspanyolca ve İngilizce baskın; okunan mesajlar arasında yalnızca 8 Türkçe mesaj var.

**Projemiz için anlamı:** OASST1, "kötü giden" etkileşimler için güvenilir ve neredeyse eksiksiz insan etiketleri sunuyor. Bu etiketler, WildChat'te ürettiğimiz zayıf etiketlerin doğrulanmasında referans olarak kullanılacak. Türkçe verinin neredeyse hiç olmaması ise Türkçe için kendi küçük etiketli setimizi oluşturmamız gerektiğini gösteriyor.

### 5.9 Veri kalitesi sorunları ve çözüm planı

| Sorun | Ölçüm | Etkisi | Nasıl ele alacağız? |
|---|---|---|---|
| **Otomatik (şablon) sohbetler** | Örneklemin %16,5'i | Yoğun kullanıcı ve döngü istatistiklerini şişirebilir | Şablon sohbetler model eğitiminden çıkarılacak, analizlerde ayrı raporlanacak |
| **Kullanıcı kimliğinin belirsizliği** | `hashed_ip` bir kişiyi değil bir ağı temsil eder | Paylaşılan ağlar ve VPN'ler kullanıcı düzeyindeki analizleri bozar | Kullanıcı ağırlıklı analiz, sonuçların temkinli yorumlanması |
| **Etiket eksikliği** | WildChat'te döngü veya memnuniyet etiketi yok | Doğrudan denetimli öğrenme yapılamaz | LLM ile ölçüt tabanlı etiketleme, ekip doğrulaması, OASST1 ile kalibrasyon |
| **Sınıf dengesizliği** | Uzun sohbetler %2,9; onarım ifadeleri %1,8 | Model azınlık sınıfını öğrenmekte zorlanır | Sınıf ağırlıkları, F1 ve PR AUC gibi dengesizliğe duyarlı metrikler |
| **Dil dengesizliği** | İngilizce %54,0, Türkçe %0,8 | Türkçe performans düşük kalabilir | Çok dilli model, Türkçe için ayrı test seti |
| **Çok kısa ve boş mesajlar** | İlk mesajların %6,3'ü 10 karakterden kısa, %0,8'i boş | Anlamsız benzerlik puanları üretebilir | En az uzunluk filtresi |
| **Tekrarlanan kayıtlar** | Sohbet kimliklerinin %0,9'u tekrar | Küçük bir sapma | Tekrarlar ayıklanacak |
| **OASST1 örneklem sırası** | Veri setinin ilk 30.000 mesajı okundu | Dil dağılımı tüm veri setini temsil etmeyebilir | Bir sonraki aşamada rastgele örneklem |
| **Öz bildirim yanlılığı** | WildChat'te yok; davranış verisi | Literatürdeki anketlerin aksine avantaj | Bu, projemizin literatüre katkısının temel dayanağı |

---

## 6. Sonuç

### 6.1 Temel bulgular

1. **Verimsiz döngüler gerçek ve ölçülebilir (AS1).** Çok turlu sohbetlerin yaklaşık üçte birinde kullanıcı aynı talebi en az bir kez neredeyse aynı şekilde tekrar gönderiyor ve bu oran sohbet uzadıkça artıyor.
2. **Kullanım güçlü biçimde yoğunlaşmış (AS2).** Kullanıcıların %1'i sohbetlerin %28'ini, %10'u yarısından fazlasını oluşturuyor; bu grubun içinde otomatik kullanım da var.
3. **Gece kullanımı belirgin (AS3).** Türkiye'den gelen sohbetlerin %30,7'si gece saatlerinde, ancak kullanıcı ağırlıklı oran %17,5. Gece kullanımı belirli bir yoğun kullanıcı grubunda toplanıyor.
4. **Kullanıcılar memnuniyetsizliklerini nadiren yazıyor.** Açık onarım ifadeleri az, ama uzun sohbetlerde 7 kat artıyor. Bu, anlam tabanlı tespitin gerekliliğini gösteriyor.
5. **Hazır etiketler var ama sınırlı (AS5).** OASST1 güvenilir insan etiketleri sunuyor, ancak Türkçe neredeyse yok.

### 6.2 Bu bulgular projeyi nasıl destekliyor?

Veri araştırması, Bölüm 1'de literatürden çıkardığımız araştırma boşluğunun veriyle doldurulabileceğini gösterdi: problemli yapay zeka kullanımının bir göstergesi olan verimsiz döngüler, anket gerektirmeden doğrudan sohbet davranışından ölçülebiliyor. Bu bulgular modelimizin girdilerini de netleştirdi:

| Model girdisi | Dayandığı bulgu |
|---|---|
| Ardışık mesaj benzerliği | Bölüm 5.5 |
| Sohbet uzunluğu ve oturum süresi | Bölüm 5.2 ve 5.5 |
| Onarım ifadeleri | Bölüm 5.6 |
| Günün saati | Bölüm 5.4 |
| İlk talebin türü | Bölüm 5.7 |
| Kişinin kendi kullanım ortalamasından sapma | Bölüm 5.3 |

**Sonraki adımlar:** Şablon sohbetlerin ayıklanması, bir örneklemin LLM ve ekip tarafından etiketlenmesi, XGBoost ile ilk modelin kurulması ve LMSYS Chat 1M üzerinde genelleme testi.

---

## 7. Kaynakça (APA 7)

Köpf, A., Kilcher, Y., von Rütte, D., Anagnostidis, S., Tam, Z. R., Stevens, K., Barhoum, A., Duc, N. M., Stanley, O., Nagyfi, R., ES, S., Suri, S., Glushkov, D., Dantuluri, A., Maguire, A., Schuhmann, C., Nguyen, H., & Mattick, A. (2023). OpenAssistant conversations: Democratizing large language model alignment. In *Advances in Neural Information Processing Systems 36* (Datasets and Benchmarks Track). https://doi.org/10.48550/arXiv.2304.07327

Phang, J., Lampe, M., Ahmad, L., Agarwal, S., Fang, C. M., Liu, A. R., Danry, V., Lee, E., Chan, S. W. T., Pataranutaporn, P., & Maes, P. (2025). *Investigating affective use and emotional well-being on ChatGPT* (arXiv:2504.03888). arXiv. https://doi.org/10.48550/arXiv.2504.03888

Reimers, N., & Gurevych, I. (2020). Making monolingual sentence embeddings multilingual using knowledge distillation. In *Proceedings of the 2020 Conference on Empirical Methods in Natural Language Processing* (pp. 4512–4525). Association for Computational Linguistics. https://doi.org/10.18653/v1/2020.emnlp-main.365

Türkiye Cumhuriyeti. (2016). *6698 sayılı Kişisel Verilerin Korunması Kanunu*. Resmî Gazete, 29677. https://www.mevzuat.gov.tr/mevzuat?MevzuatNo=6698&MevzuatTur=1&MevzuatTertip=5

Zhao, W., Ren, X., Hessel, J., Cardie, C., Choi, Y., & Deng, Y. (2024). WildChat: 1M ChatGPT interaction logs in the wild. In *The Twelfth International Conference on Learning Representations (ICLR 2024)*. https://doi.org/10.48550/arXiv.2405.01470

Zheng, L., Chiang, W. L., Sheng, Y., Li, T., Zhuang, S., Wu, Z., Zhuang, Y., Li, Z., Lin, Z., Xing, E. P., Gonzalez, J. E., Stoica, I., & Zhang, H. (2024). LMSYS-Chat-1M: A large-scale real-world LLM conversation dataset. In *The Twelfth International Conference on Learning Representations (ICLR 2024)*. https://doi.org/10.48550/arXiv.2309.11998
