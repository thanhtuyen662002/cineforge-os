# CineForge OS — Character, Voice, Prop & Continuity Architecture

> Mục tiêu: bảo đảm nhiều nhân vật, nhiều giọng, trang phục, đạo cụ, phong cách và trạng thái thay đổi theo câu chuyện nhưng vẫn duy trì identity ổn định xuyên suốt production.

## 1. Sai lầm phải tránh

Không thiết kế:
```text
Character {
  name
  image
  voice_id
  outfit
  prompt
}
```

Mô hình này thất bại vì:
- đổi outfit làm thay “identity”;
- một voice provider biến mất sẽ làm nhân vật mất giọng;
- không biểu diễn được tuổi/trạng thái theo timeline;
- không quản lý được vật dụng sở hữu tạm thời;
- không biết shot nào đã dùng revision nào;
- không biết đặc điểm nào bất biến và đặc điểm nào được phép đổi.

## 2. Character = Stable Identity + Versioned Packages + Story State

```text
Character
├─ CharacterIdentity        (stable logical identity)
├─ VisualIdentityPackage    (versioned, approved)
├─ VoiceIdentityPackage     (versioned, approved)
├─ PerformanceBible         (versioned)
├─ StyleBinding             (versioned)
├─ RightsProfile            (versioned)
└─ CharacterStateTimeline
    ├─ appearance state
    ├─ costume state
    ├─ prop possession
    ├─ injury/condition
    ├─ emotion
    ├─ location
    ├─ knowledge
    └─ relationship state
```

## 3. Visual Identity Package

Phải có thể khóa riêng:
- species/ethnicity/age impression nếu applicable;
- body proportions;
- face topology/landmarks;
- eyes;
- nose/muzzle/mouth;
- ears;
- hair/fur;
- skin/fur palette;
- height/relative scale;
- silhouette;
- characteristic markings;
- hands/feet/tail/wings...;
- neutral expressions;
- canonical turnarounds;
- reference images;
- approved embeddings/features cho QC;
- forbidden drift notes.

Không gộp costume/props vào body identity.

## 4. Character Lock Levels

### IDENTITY_LOCK
Không được tự đổi:
- face/body identity;
- age impression;
- core anatomy;
- canonical palette/markings.

### STYLE_LOCK
Khóa:
- rendering universe;
- material response;
- line/shading language;
- stylization degree.

### COSTUME_LOCK
Khóa theo story interval:
- outfit;
- footwear;
- accessories;
- damage/wetness/dirt state.

### PROP_BINDING
Khóa quan hệ character ↔ prop trong khoảng timeline cụ thể.

### VOICE_LOCK
Khóa voice identity package revision.

Mỗi lock có:
- scope;
- effective story interval;
- revision;
- owner/approver;
- override policy;
- reason.

## 5. Voice Identity không được chỉ là provider voice_id

```text
VoiceIdentityPackage
├─ semantic description
├─ canonical reference recordings
├─ language/accent profile
├─ vocal range
├─ pace/rhythm
├─ timbre descriptors
├─ prosody tendencies
├─ emotional capability map
├─ pronunciation lexicon
├─ forbidden traits
├─ provider bindings[]
└─ rights/consent
```

Provider binding:
```text
VoiceProviderBinding {
  provider
  provider_voice_id
  model/version
  creation_method
  reference revision
  tested languages
  quality profile
  rights constraints
  active/deprecated
}
```

Nếu ElevenLabs/Local/khác thay đổi, Character vẫn có VoiceIdentityPackage; chỉ binding thay đổi.

Các dịch vụ voice cloning hiện nay cũng cho thấy reference quality, accent, performance và single-speaker cleanliness ảnh hưởng trực tiếp tới clone; vì vậy reference recordings phải được quản lý như canonical production assets, không phải file upload tạm.

## 6. Một nhân vật, nhiều ngôn ngữ

Không giả định một voice model giữ identity hoàn hảo trên mọi ngôn ngữ.

Voice package có:
- canonical voice identity;
- per-language binding;
- pronunciation lexicon;
- approved pronunciation;
- fallback strategy.

Ví dụ:
```text
OTTO
  vi-VN → VoiceBinding A
  en-US → VoiceBinding B
```

Hai binding phải được human/AI review xem có còn “cùng nhân vật” hay không.

## 7. Dialogue Entity

Mỗi câu thoại là domain entity:

```text
DialogueLine
- line_id
- character_id
- scene_id
- story_time
- original_text
- language
- translated_text revisions
- performance_intent
- emotion
- intensity
- pace
- pause markers
- pronunciation directives
- voice_package_revision
- generated_take_ids[]
- selected_take_id
- timing
- lip_sync_binding
```

Không lưu thoại chỉ trong subtitle hoặc prompt.

## 8. Multi-character scene

Scene phải có CastBinding:
- character logical ID;
- visual identity revision;
- voice identity revision;
- current costume revision;
- current story state;
- current prop bindings.

Shot tạo ra phải pin snapshot này.

Nếu character canonical revision thay đổi sau đó:
- shot cũ không tự mutate;
- dependency graph đánh dấu STALE;
- impact analysis cho biết shot nào bị ảnh hưởng;
- user chọn review/re-render/waive.

## 9. Prop system

Prop là first-class entity, không phải text trong prompt.

```text
Prop
├─ IdentityPackage
├─ VisualReferences
├─ PhysicalProperties
├─ StateTimeline
├─ Ownership/PossessionTimeline
├─ Damage/ModificationTimeline
├─ Rights
└─ ApprovedRevisions
```

Ví dụ thanh kiếm:
- Scene 1 sạch;
- Scene 5 dính máu;
- Scene 8 gãy;
- Scene 12 không thể xuất hiện nguyên vẹn nếu chưa có causal event sửa/thay.

## 10. Costume system

Costume:
- costume identity;
- components;
- colors/materials;
- fit;
- accessories;
- footwear;
- damage/wetness/dirt layers;
- canonical references;
- story interval.

Tách:
```text
Base Costume
+ State Modifier
```

Không tạo costume mới chỉ vì áo bị ướt.

## 11. Environment/World Identity

Environment cũng cần lock:
- topology/geography;
- dimensions/relative scale;
- entrances/exits;
- landmark props;
- lighting baseline;
- weather/time-of-day state;
- damage/evolution timeline.

Camera blocking và character position phải tham chiếu world-space state khi workflow hỗ trợ.

## 12. Style system

Style không phải một prompt string.

```text
StyleBible
- medium
- realism/stylization
- shape language
- color language
- lighting philosophy
- lens/camera language
- texture/material language
- motion language
- editing language
- audio/music language
- negative constraints
- reference board
```

Style can inherit:
Studio → Franchise → Production → Sequence → Scene → Shot override.

Override phải hiển thị nguồn inheritance và không silent.

## 13. Performance Identity

PerformanceBible cho mỗi nhân vật:
- posture;
- gait;
- gesture vocabulary;
- eye behavior;
- reaction delay;
- energy;
- speaking rhythm;
- emotional baseline;
- behaviors under stress;
- forbidden performance drift.

Face similarity không đủ để xác minh character consistency.

## 14. Continuity Snapshot

Mỗi shot trước khi generation phải materialize:

```text
ShotContinuitySnapshot
- character revisions
- voice revisions
- costume states
- prop states
- environment state
- time/weather
- injuries
- dirt/wetness
- knowledge state
- relationships
- screen direction
- camera geography
- previous/next shot anchors
```

Generation và QC phải dùng chính snapshot này.

## 15. Identity QC

QC nhiều tầng:
- visual identity;
- body proportions;
- costume;
- prop presence/state;
- voice identity;
- pronunciation;
- lip sync;
- performance identity;
- environment identity;
- temporal stability;
- cross-shot continuity.

Kết quả không chỉ PASS/FAIL mà có UNKNOWN/OUT_OF_DOMAIN.

## 16. Voice QC

Voice QC kiểm:
- wrong speaker;
- identity similarity;
- language/accent;
- pronunciation;
- transcript;
- prosody;
- pace;
- emotion;
- clipping/noise;
- loudness;
- timing;
- room/acoustic consistency;
- lip-sync compatibility.

Speaker diarization chỉ là evidence, không canonical truth.

## 17. Repair policy

Không repair tuần tự vô hạn.

Mọi repair tạo attempt mới từ best valid ancestor.

Detect cycle:
- face repair hurts lipsync;
- lipsync repair hurts face;
- expression repair hurts identity.

Có:
- attempt budget;
- Pareto comparison;
- regenerate strategy switch;
- human escalation.

## 18. Character UI

Màn hình Character mặc định:
- Hero preview;
- Tên;
- Trạng thái: Canon / Draft;
- Ngoại hình;
- Giọng;
- Trang phục;
- Vật dụng;
- Diễn xuất;
- Ngôn ngữ;
- Rights;
- Used in X scenes.

Không expose embeddings/model IDs mặc định.

User action:
- Khóa nhân vật;
- Tạo biến thể;
- Đổi giọng;
- Thử giọng;
- Thêm trang phục;
- Thêm đạo cụ;
- Xem ảnh hưởng nếu thay đổi;
- Version history.

## 19. Voice casting UX

User chọn character → Giọng nói:
- Tạo giọng mới;
- Clone giọng có quyền;
- Chọn voice có sẵn;
- Import voice performance;
- Dùng provider khác;
- Thu âm người thật.

Preview phải dùng cùng một vài câu chuẩn để A/B.

Sau khi lock:
```text
Voice: Đã khóa
Languages: vi-VN ✓, en-US ✓
Provider bindings: 2
Canonical references: 4
```

Nếu binding chết, CineForge báo:
“Giọng OTTO vẫn còn canonical profile; provider hiện tại không khả dụng. Có thể tạo binding thay thế và A/B với giọng đã duyệt.”

## 20. Multi-speaker production

Dialogue scheduler phải biết:
- ai nói đoạn nào;
- line dependencies;
- overlap;
- interruptions;
- off-screen voice;
- crowd/background;
- ADR/replacement.

Không ghép TTS từng câu độc lập mà bỏ context. Có thể group dialogue by conversational context, nhưng output vẫn map trở lại từng DialogueLine.

## 21. Rights

Voice/person likeness:
- consent source;
- allowed uses;
- languages;
- territories;
- expiration;
- training permission;
- cloning permission;
- commercial permission;
- revocation.

Provider consent checkbox không thay CineForge Rights record.

## 22. Core invariants

1. Character logical identity không phụ thuộc provider.
2. Visual identity, voice identity, costume, prop state là các revision/state riêng.
3. Production shot pin exact revisions.
4. Canon change chỉ invalidates; không mutate shot cũ.
5. Voice provider ID không bao giờ là canonical voice identity.
6. Dialogue luôn gắn character + voice revision + story context.
7. Props/costumes có timeline state.
8. Không dùng previous generated shot làm canonical identity source.
9. Human-approved references immutable.
10. Repair không overwrite approved artifact.
11. Rights revocation propagation phải truy được mọi derivative.
12. UNKNOWN identity/QC không được tự PASS.
