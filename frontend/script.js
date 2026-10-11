/**
 * ECHOATLAS — Accessible Breast-Ultrasound Case-Learning Workstation
 * Educational, non-diagnostic UI controller (Code Ada 2026 · Tech for Equity).
 *
 * Integration contract with the backend (see TEAM_PLAN.md):
 *   POST /predict -> {
 *     mode: "trained-baseline" | "trained" | "unavailable",
 *     prediction: "normal" | "benign" | "malignant",
 *     probabilities: { normal: 0.1, benign: 0.72, malignant: 0.18 },
 *     segmentation_mask: "data:image/png;base64,...",
 *     inference_time_ms: 42
 *   }
 *   GET /api/status -> { model_loaded, mode?, classes, device, metrics? }
 *   GET /api/cases  -> OPTIONAL list of real dataset cases:
 *     [{ id, title, image, annotation_mask?, reference_label?, description?, source? }]
 *
 * Honesty rules enforced here:
 *   - Model output is shown ONLY for an explicitly trained baseline/production model
 *     and a recognized BUSI class. Anything else is shown
 *     as "demo-only" and the prediction is discarded.
 *   - Dataset annotations/labels and model output are always labelled separately.
 */

(function () {
  "use strict";

  const API_BASE = window.location.origin.includes("http") ? window.location.origin : "http://127.0.0.1:8000";

  // Classes the EchoAtlas UI understands.
  const CLASS_META = {
    normal: { label: "Normal", badgeClass: "badge-success", color: "#8CE1B1" },
    benign: { label: "Benign", badgeClass: "badge-success", color: "#2EC4B6" },
    malignant: { label: "Malignant", badgeClass: "badge-warning", color: "#FF7F6E" }
  };

  const ANNOTATION_COLOR = "#FF7F6E";
  const HISTORY_KEY = "echoatlas_history";
  const THEME_KEY = "echoatlas_theme";

  // ---------------------------------------------------------------------
  // State
  // ---------------------------------------------------------------------
  const state = {
    cases: [],
    caseSource: "illustrative", // "illustrative" | "dataset"
    currentCase: null,
    history: [],
    historyCounter: 0,
    reportEntryId: null,
    practice: { cases: [], index: 0, matches: 0, answered: false },
    guidedTour: { active: false, step: 0, busy: false, targetEl: null, scrolledToStep: -1 },
    maskCache: {}, // entryId -> mask data URL (memory only)
    pendingUpload: null, // { file, dataUrl, width, height }
    activeTab: "overview",
    chat: { configured: false, modelLabel: "Gemini Learning Guide", messages: [], attachment: null, imageConsent: false, sending: false, busyKind: "reply", error: "" },
    atlasLocation: "Egypt",
    model: {
      online: false,
      loaded: false,
      mode: "unknown",
      compatible: false,
      device: "—",
      classes: [],
      metrics: null
    },
    viewer: {
      zoom: 1.0,
      brightness: 100,
      contrast: 100,
      annotationOpacity: 85,
      modelOpacity: 70,
      showAnnotation: false,
      showModel: false,
      showDifference: false
    }
  };

  // Curated public dataset metadata snapshot; institutional collection sources, not patient residences.
  // Image counts and access terms come from verified public sources/publications; never summed across datasets.
  let ATLAS_DATASETS = [
    {
      name: "BUSI",
      dataset_name: "BUSI (Dataset of Breast Ultrasound Images)",
      country: "Egypt",
      collection_country: "Egypt",
      location: "Cairo",
      collection_location: "Cairo (Baheya Hospital for Early Detection and Treatment of Women's Cancer)",
      images: 780,
      image_count: 780,
      count_type: "publication-reported",
      sample_unit: "images",
      cohort_details: "600 female patients aged 25-78; 487 benign, 210 malignant, 133 normal images",
      access: "Public research dataset",
      href: "https://scholar.cu.edu.eg/?q=afahmy/pages/dataset",
      source_url: "https://scholar.cu.edu.eg/?q=afahmy/pages/dataset",
      publication_url: "https://doi.org/10.1016/j.dib.2019.104863",
      citation: "Al-Dhabyani et al. (2020), Data in Brief 28:104863",
      source: "Cairo University / Data in Brief",
      provenance_source: "Data in Brief (Al-Dhabyani et al., 2020) & Cairo University repository",
      loaded: true,
      map_x: 587,
      map_y: 167
    },
    {
      name: "BCMID",
      dataset_name: "BCMID (Breast Cancer Multimodal Imaging Dataset)",
      country: "Egypt",
      collection_country: "Egypt",
      location: "Cairo & Alexandria",
      collection_location: "Cairo & Alexandria (Ain Shams Univ & Alexandria Univ Medical Centers)",
      images: 3223,
      image_count: 3223,
      count_type: "source-reported",
      sample_unit: "images",
      cohort_details: "3,223 breast cancer multimodal ultrasound & mammography images across 323 patients",
      access: "Public · CC BY 4.0",
      href: "https://zenodo.org/records/14970848",
      source_url: "https://zenodo.org/records/14970848",
      publication_url: "https://doi.org/10.5281/zenodo.14970848",
      citation: "Seddik Tawfik, N., Ghatwary, N., Elgendy, A., Nasr, O., & Ye, X. (2025). BCMID: Breast Cancer Multimodal Imaging Dataset. Zenodo.",
      provenance_source: "Zenodo record 14970848 & OpenHub catalog",
      source: "Zenodo / Ain Shams Univ.",
      loaded: false,
      map_x: 583,
      map_y: 163
    },
    {
      name: "BUS-BRA",
      dataset_name: "BUS-BRA (A Breast Ultrasound Dataset for Assessing CAD Systems)",
      country: "Brazil",
      collection_country: "Brazil",
      location: "Rio de Janeiro",
      collection_location: "Rio de Janeiro (Universidade Federal do Rio de Janeiro & Universidade Estácio de Sá)",
      images: 1875,
      image_count: 1875,
      count_type: "publication-reported",
      sample_unit: "images",
      cohort_details: "1,064 patients; 1,875 B-mode images (1,268 benign, 607 malignant) with segmentations",
      access: "Public · CC BY 4.0",
      href: "https://zenodo.org/records/8231412",
      source_url: "https://zenodo.org/records/8231412",
      publication_url: "https://doi.org/10.1002/mp.16812",
      citation: "Gómez-Flores et al. (2024), Medical Physics 51(3):2326-2337",
      source: "Zenodo / Medical Physics",
      provenance_source: "Medical Physics (Gómez-Flores et al., 2024) & Zenodo 8231412",
      loaded: false,
      map_x: 380,
      map_y: 314
    },
    {
      name: "UDIAT",
      dataset_name: "UDIAT (Breast Ultrasound Dataset B)",
      country: "Spain",
      collection_country: "Spain",
      location: "Sabadell",
      collection_location: "Sabadell (UDIAT-Centre Diagnòstic, Corporació Sanitària Parc Taulí)",
      images: 163,
      image_count: 163,
      count_type: "publication-reported",
      sample_unit: "images",
      cohort_details: "163 B-mode ultrasound images (110 benign, 53 malignant) collected in Sabadell, Spain",
      access: "Research access by request",
      href: "https://helward.mmu.ac.uk/STAFF/m.yap/dataset.php",
      source_url: "https://helward.mmu.ac.uk/STAFF/m.yap/dataset.php",
      publication_url: "https://doi.org/10.1109/JBHI.2017.2731873",
      citation: "Yap et al. (2018), IEEE JBHI 22(4):1218-1226",
      source: "UDIAT / MMU Dataset Page",
      provenance_source: "IEEE JBHI (Yap et al., 2018) & MMU dataset portal",
      loaded: false,
      map_x: 506,
      map_y: 135
    },
    {
      name: "BUS-UCLM",
      dataset_name: "BUS-UCLM (Breast Ultrasound Lesion Segmentation Dataset)",
      country: "Spain",
      collection_country: "Spain",
      location: "Ciudad Real",
      collection_location: "Ciudad Real (Hospital General Universitario de Ciudad Real)",
      images: 683,
      image_count: 683,
      count_type: "publication-reported",
      sample_unit: "images",
      cohort_details: "683 ultrasound images (419 normal, 174 benign, 90 malignant) with segmentations",
      access: "Public · CC BY-NC 3.0",
      href: "https://github.com/noeliavallez/BUS-UCLM-Dataset",
      source_url: "https://github.com/noeliavallez/BUS-UCLM-Dataset",
      publication_url: "https://doi.org/10.1038/s41597-025-04562-3",
      citation: "Vallez et al. (2025), Scientific Data 12:185",
      source: "Scientific Data / GitHub",
      provenance_source: "Scientific Data (Vallez et al., 2025) & GitHub repository",
      loaded: false,
      map_x: 489,
      map_y: 142
    },
    {
      name: "OASBUD",
      dataset_name: "OASBUD (Open Access Database of Raw Ultrasonic Signals from Breast Lesions)",
      country: "Poland",
      collection_country: "Poland",
      location: "Warsaw",
      collection_location: "Warsaw (Cancer Center & Institute of Oncology M. Skłodowska-Curie Memorial / IPPT PAN)",
      images: 100,
      image_count: 100,
      count_type: "publication-reported",
      sample_unit: "lesion cases",
      cohort_details: "100 breast focal lesions (52 malignant, 48 benign) with raw RF data and reconstructed B-mode",
      access: "Public · CC BY 4.0",
      href: "https://zenodo.org/records/545928",
      source_url: "https://zenodo.org/records/545928",
      publication_url: "https://doi.org/10.1002/mp.12538",
      citation: "Piotrzkowska-Wróblewska et al. (2017), Medical Physics 44(11):6100-6109",
      source: "Zenodo / Medical Physics / IPPT PAN",
      provenance_source: "Medical Physics (Piotrzkowska-Wróblewska et al., 2017) & Zenodo 545928",
      loaded: false,
      map_x: 558,
      map_y: 105
    },
    {
      name: "BrEaST",
      dataset_name: "BrEaST (Curated Benchmark Dataset for Ultrasound-Based Breast Lesion Analysis)",
      country: "Poland",
      collection_country: "Poland",
      location: "Kraków & Wrocław",
      collection_location: "Kraków & Wrocław (Maria Sklodowska-Curie Oncology Kraków & Lower Silesian Oncology Center)",
      images: 256,
      image_count: 256,
      count_type: "publication-reported",
      sample_unit: "scans",
      cohort_details: "256 patients (256 scans: 154 benign, 98 malignant, 4 normal) across 4 probe types",
      access: "Public · CC BY 4.0",
      href: "https://www.cancerimagingarchive.net/collection/breast-lesions-usg/",
      source_url: "https://www.cancerimagingarchive.net/collection/breast-lesions-usg/",
      publication_url: "https://doi.org/10.1038/s41597-024-02984-z",
      citation: "Pawłowska et al. (2024), Nature Scientific Data 11:132",
      source: "TCIA / Nature Scientific Data",
      provenance_source: "Nature Scientific Data (Pawłowska et al., 2024) & TCIA Breast-Lesions-USG",
      loaded: false,
      map_x: 555,
      map_y: 111
    },
    {
      name: "HMSS",
      dataset_name: "HMSS (UltrasoundCases Breast & Axilla Archive)",
      country: "Netherlands",
      collection_country: "Netherlands",
      location: "Eindhoven",
      collection_location: "Eindhoven (Hitachi Medical Systems Europe)",
      images: 503,
      image_count: 503,
      count_type: "source-reported",
      sample_unit: "cases",
      cohort_details: "503 educational breast and axilla ultrasound cases with biopsy-confirmed pathology findings",
      access: "Public educational repository",
      href: "https://www.ultrasoundcases.info/cases/breast-and-axilla/",
      source_url: "https://www.ultrasoundcases.info/cases/breast-and-axilla/",
      publication_url: "https://www.ultrasoundcases.info/",
      citation: "Hitachi Medical Systems Europe. (2024). UltrasoundCases: Breast and axilla case collection.",
      provenance_source: "UltrasoundCases.info public repository",
      source: "Hitachi Medical Systems / ultrasoundcases.info",
      loaded: false,
      map_x: 515,
      map_y: 107
    },
    {
      name: "BUSIS",
      dataset_name: "BUSIS (Benchmark for Breast Ultrasound Image Segmentation)",
      country: "China",
      collection_country: "China",
      location: "Harbin, Qingdao & Shijiazhuang",
      collection_location: "Harbin, Qingdao, and Shijiazhuang (2nd Affiliated Hosp Harbin, Affiliated Hosp Qingdao, 2nd Hosp Hebei)",
      images: 562,
      image_count: 562,
      count_type: "publication-reported",
      sample_unit: "images",
      cohort_details: "562 B-mode breast ultrasound images from women aged 26-78 annotated by 4 radiologists",
      access: "Public research benchmark",
      href: "http://cvprip.cs.usu.edu/busbench",
      source_url: "http://cvprip.cs.usu.edu/busbench",
      publication_url: "https://doi.org/10.3390/healthcare10040729",
      citation: "Zhang et al. (2022), Healthcare 10(4):729",
      source: "Utah State Univ. / MDPI Healthcare",
      provenance_source: "Healthcare (Zhang et al., 2022) & Utah State Univ. CVPRIP benchmark",
      loaded: false,
      map_x: 818,
      map_y: 144
    },
    {
      name: "GDPH&SYSUCC",
      dataset_name: "GDPH&SYSUCC Breast Ultrasound Dataset",
      country: "China",
      collection_country: "China",
      location: "Guangzhou",
      collection_location: "Guangzhou (Guangdong Provincial People's Hospital & Sun Yat-sen University Cancer Center)",
      images: 2405,
      image_count: 2405,
      count_type: "publication-reported",
      sample_unit: "images",
      cohort_details: "2,405 B-mode images (886 benign, 1,519 malignant) from 1,202 patients",
      access: "Public research dataset",
      href: "https://github.com/yuhaomo/HoVerTrans",
      source_url: "https://github.com/yuhaomo/HoVerTrans",
      publication_url: "https://arxiv.org/abs/2205.08390",
      citation: "Mo, Y., Han, C., Liu, Y., et al. (2022). HoVer-Trans: Anatomy-aware hover-transformer for ROI classification in breast ultrasound. arXiv:2205.08390.",
      provenance_source: "arXiv:2205.08390 & HoVerTrans repository",
      source: "Sun Yat-sen Univ / GDPH",
      loaded: false,
      map_x: 815,
      map_y: 186
    },
    {
      name: "US3M",
      dataset_name: "US3M (Multimodal Breast Ultrasound Dataset)",
      country: "China",
      collection_country: "China",
      location: "Changsha",
      collection_location: "Changsha (Xiangya Hospital, Central South University)",
      images: 1532,
      image_count: 1532,
      count_type: "publication-reported",
      sample_unit: "images",
      cohort_details: "1,532 multimodal breast ultrasound images (B-mode and color Doppler) from 248 patients",
      access: "Public · CC BY-NC 4.0",
      href: "https://www.kaggle.com/datasets/timesxy/multimodal-breast-ultrasound-dataset-us3m",
      source_url: "https://www.kaggle.com/datasets/timesxy/multimodal-breast-ultrasound-dataset-us3m",
      publication_url: "https://doi.org/10.1016/j.inffus.2024.102604",
      citation: "Yan, P., Gong, W., Li, M., et al. (2024). TDF-Net: Trusted dynamic fusion network for multimodal breast ultrasound diagnosis. Information Fusion, 102604.",
      provenance_source: "Information Fusion (Yan et al., 2024) & Kaggle US3M portal",
      source: "Central South Univ / Kaggle",
      loaded: false,
      map_x: 814,
      map_y: 172
    },
    {
      name: "BUSI_WHU",
      dataset_name: "BUSI_WHU (Breast Cancer Ultrasound Image Dataset)",
      country: "China",
      collection_country: "China",
      location: "Wuhan",
      collection_location: "Wuhan (Wuhan University)",
      images: 927,
      image_count: 927,
      count_type: "source-reported",
      sample_unit: "images",
      cohort_details: "927 B-mode breast ultrasound images with lesion segmentation masks",
      access: "Public · CC BY 4.0",
      href: "https://data.mendeley.com/datasets/k6cpmwybk3/1",
      source_url: "https://data.mendeley.com/datasets/k6cpmwybk3/1",
      publication_url: null,
      citation: "Huang et al. (2023), Mendeley Data, V1",
      source: "Mendeley Data",
      provenance_source: "Mendeley Data V1 (Huang et al., 2023)",
      loaded: false,
      map_x: 818,
      map_y: 165
    },
    {
      name: "BreastVid",
      dataset_name: "BreastVid (Breast Lesion Detection in Ultrasound Videos)",
      country: "China",
      collection_country: "China",
      location: "Shenzhen",
      collection_location: "Shenzhen (Shenzhen Institute of Advanced Technology & Affiliated Hospitals)",
      images: 188,
      image_count: 188,
      count_type: "publication-reported",
      sample_unit: "videos/images",
      cohort_details: "188 ultrasound videos and image frames (75 benign, 113 malignant) with bounding boxes",
      access: "Public research dataset",
      href: "https://github.com/jhl-Det/CVA-Net",
      source_url: "https://github.com/jhl-Det/CVA-Net",
      publication_url: "https://doi.org/10.1007/978-3-031-16437-8_59",
      citation: "Lin, Z., Lin, J., Zhu, L., et al. (2022). A new dataset and a baseline model for breast lesion detection in ultrasound video. MICCAI 2022.",
      provenance_source: "MICCAI 2022 (Lin et al.) & CVA-Net repository",
      source: "SIAT / Springer MICCAI",
      loaded: false,
      map_x: 817,
      map_y: 187
    },
    {
      name: "ALN-Ultra",
      dataset_name: "ALN-Ultra (Axillary Lymph Node & Breast Ultrasound Dataset)",
      country: "China",
      collection_country: "China",
      location: "Fuzhou",
      collection_location: "Fuzhou (Fuzhou University Affiliated Provincial Hospital)",
      images: 258,
      image_count: 258,
      count_type: "source-reported",
      sample_unit: "images/videos",
      cohort_details: "258 breast ultrasound images and videos with lesion classification",
      access: "Public · CC BY 4.0",
      href: "https://zenodo.org/records/15003119",
      source_url: "https://zenodo.org/records/15003119",
      publication_url: "https://doi.org/10.5281/zenodo.15003119",
      citation: "Fuzhou University Affiliated Provincial Hospital. (2025). ALN-Ultra. Zenodo.",
      provenance_source: "Zenodo record 15003119",
      source: "Zenodo / Fuzhou Univ",
      loaded: false,
      map_x: 831,
      map_y: 178
    },
    {
      name: "MID",
      dataset_name: "MID (Online Medical Images Breast Ultrasound)",
      country: "Thailand",
      collection_country: "Thailand",
      location: "Bangkok",
      collection_location: "Bangkok (Online Medical Images archive)",
      images: 296,
      image_count: 296,
      count_type: "source-reported",
      sample_unit: "images",
      cohort_details: "296 breast ultrasound scan images classified into benign and malignant lesions",
      access: "Public educational repository",
      href: "http://onlinemedicalimages.com/index.php/en/site-map",
      source_url: "http://onlinemedicalimages.com/index.php/en/site-map",
      publication_url: "http://onlinemedicalimages.com/",
      citation: "OnlineMedicalImages. (2023). Breast Ultrasound Image Database.",
      provenance_source: "OnlineMedicalImages.com public database",
      source: "OnlineMedicalImages.com",
      loaded: false,
      map_x: 779,
      map_y: 212
    },
    {
      name: "BUS_UC",
      dataset_name: "BUS_UC",
      country: "Pakistan",
      collection_country: "Pakistan",
      location: null,
      collection_location: null,
      images: 811,
      image_count: 811,
      count_type: "publication-reported",
      sample_unit: "images",
      cohort_details: "811 B-mode images (358 benign, 453 malignant) with lesion masks",
      access: "Public · CC BY 4.0",
      href: "https://data.mendeley.com/datasets/3ksd7w7jkx/1",
      source_url: "https://data.mendeley.com/datasets/3ksd7w7jkx/1",
      publication_url: "https://doi.org/10.1016/j.eswa.2023.121476",
      citation: "Iqbal et al. (2023), Expert Systems with Applications",
      source: "Mendeley Data",
      provenance_source: "Expert Systems with Applications & Mendeley Data",
      loaded: false,
      map_x: 702,
      map_y: 156
    },
    {
      name: "QAMEBI",
      dataset_name: "QAMEBI (Breast Ultrasound Images Database)",
      country: "Iran",
      collection_country: "Iran",
      location: "Urmia",
      collection_location: "Urmia (Urmia University of Medical Sciences)",
      images: 232,
      image_count: 232,
      count_type: "publication-reported",
      sample_unit: "images",
      cohort_details: "232 B-mode ultrasound images (109 benign, 123 malignant) with expert lesion masks",
      access: "Public research database",
      href: "https://qamebi.com/breast-ultrasound-images-database",
      source_url: "https://qamebi.com/breast-ultrasound-images-database",
      publication_url: "https://doi.org/10.1016/j.compbiomed.2022.106465",
      citation: "Ardakani et al. (2022), Computers in Biology and Medicine 151:106465",
      source: "QAMEBI / Computers in Biology and Medicine",
      provenance_source: "Computers in Biology and Medicine & QAMEBI database",
      loaded: false,
      map_x: 625,
      map_y: 146
    },
    {
      name: "MMU-A",
      dataset_name: "MMU Dataset A (Breast Ultrasound Lesion Detection Dataset)",
      country: "United Kingdom",
      collection_country: "United Kingdom",
      location: "Manchester",
      collection_location: "Manchester (Manchester Metropolitan University)",
      images: 306,
      image_count: 306,
      count_type: "publication-reported",
      sample_unit: "images",
      cohort_details: "306 breast ultrasound images (246 benign, 60 malignant) with radiologist lesion annotations",
      access: "Research access by request",
      href: "https://helward.mmu.ac.uk/STAFF/m.yap/dataset.php",
      source_url: "https://helward.mmu.ac.uk/STAFF/m.yap/dataset.php",
      publication_url: "https://doi.org/10.1109/JBHI.2017.2731873",
      citation: "Yap, M. H., Pons, G., Martí, J., et al. (2018). Automated breast ultrasound lesions detection using convolutional neural networks. IEEE JBHI, 22(4), 1218-1226.",
      source: "MMU / IEEE JBHI",
      provenance_source: "IEEE JBHI & Manchester Metropolitan University repository",
      loaded: false,
      map_x: 494,
      map_y: 101
    },
    {
      name: "AI-Hub Korea",
      dataset_name: "AI-Hub Breast Cancer Ultrasound Dataset (유방암 진단 의료 영상)",
      country: "South Korea",
      collection_country: "South Korea",
      location: "Seoul",
      collection_location: "Seoul & Participating Medical Centers (National Information Society Agency)",
      images: 1200,
      image_count: 1200,
      count_type: "source-reported",
      sample_unit: "patient cases",
      cohort_details: "1,200 patient ultrasound cases (600 benign, 600 malignant) curated for Korean AI medical imaging research",
      access: "Public research access via AI-Hub Safe Zone",
      href: "https://www.aihub.or.kr",
      source_url: "https://www.aihub.or.kr",
      publication_url: "https://www.aihub.or.kr/aihubdata/data/view.do?currMenu=115&topMenu=100&aihubDataSe=realm&dataSetSn=175",
      citation: "National Information Society Agency (NIA). (2020). Breast Cancer Diagnostic Medical Imaging Dataset. AI-Hub Korea.",
      source: "AI-Hub / NIA South Korea",
      provenance_source: "AI-Hub Korea (National Information Society Agency / MSIT)",
      loaded: false,
      map_x: 853,
      map_y: 146
    },
    {
      name: "TDSC-ABUS",
      dataset_name: "TDSC-ABUS (Tumor Detection & Segmentation on 3D Automated Breast Ultrasound)",
      country: "China",
      collection_country: "China",
      location: "Shenzhen & Guangzhou",
      collection_location: "Shenzhen & Guangzhou (Perception Computing Lab & Collaborating Centers)",
      images: 100,
      image_count: 100,
      count_type: "publication-reported",
      sample_unit: "3D ABUS volumes",
      cohort_details: "100 automated 3D breast ultrasound volumes with lesion masks and benign/malignant pathology labels",
      access: "Public benchmark challenge",
      href: "https://tdsc-abus2023.grand-challenge.org/",
      source_url: "https://tdsc-abus2023.grand-challenge.org/",
      publication_url: "https://arxiv.org/abs/2501.15588",
      citation: "Perception Computing Lab. (2023). TDSC-ABUS Challenge Dataset. Grand Challenge.",
      source: "Perception Computing Lab / Grand Challenge",
      provenance_source: "TDSC-ABUS Challenge / arXiv:2501.15588",
      loaded: false,
      map_x: 817,
      map_y: 187
    },
    {
      name: "CADBUSI",
      dataset_name: "CADBUSI (Computer-Aided Diagnosis for Breast Ultrasound Imaging)",
      country: "United States",
      collection_country: "United States",
      location: "Rochester, MN",
      collection_location: "Rochester, Minnesota (Mayo Clinic Health System)",
      images: 756315,
      image_count: 756315,
      count_type: "publication-reported",
      sample_unit: "images",
      cohort_details: "79,281 exams across 60,688 patients; 756,315 images & 136,197 videos (68,645 benign, 10,636 malignant)",
      access: "Public clinical research cohort · Mayo Clinic",
      href: "https://doi.org/10.1007/s10278-025-01784-0",
      source_url: "https://doi.org/10.1007/s10278-025-01784-0",
      publication_url: "https://doi.org/10.1007/s10278-025-01784-0",
      citation: "Hansen, T., et al. (2026). Computer-Aided Diagnosis for Breast Ultrasound Imagery Dataset. Journal of Imaging Informatics in Medicine, 10.1007/s10278-025-01784-0.",
      source: "Mayo Clinic Health System / JIIM",
      provenance_source: "Journal of Imaging Informatics in Medicine & Mayo Clinic Health System",
      loaded: false,
      map_x: 195,
      map_y: 145
    },
    {
      name: "BUI-FEI",
      dataset_name: "BUI-FEI (Breast Ultrasound Image Dataset by Rodrigues)",
      country: "Brazil",
      collection_country: "Brazil",
      location: "São Paulo",
      collection_location: "São Bernardo do Campo, São Paulo (Centro Universitário FEI)",
      images: 250,
      image_count: 250,
      count_type: "source-reported",
      sample_unit: "images",
      cohort_details: "250 ultrasound images from female patients (100 benign, 150 malignant)",
      access: "Public · CC BY 4.0",
      href: "https://data.mendeley.com/datasets/wmy84gzngw/1",
      source_url: "https://data.mendeley.com/datasets/wmy84gzngw/1",
      publication_url: "https://doi.org/10.17632/wmy84gzngw.1",
      citation: "Rodrigues, P. S. (2017). Breast Ultrasound Image. Mendeley Data, V1, doi: 10.17632/wmy84gzngw.1.",
      source: "Centro Universitário FEI / Mendeley Data",
      provenance_source: "Mendeley Data & Centro Universitário FEI",
      loaded: false,
      map_x: 335,
      map_y: 325
    }
  ];

  // ---------------------------------------------------------------------
  // Small utilities
  // ---------------------------------------------------------------------
  const $ = id => document.getElementById(id);

  function esc(value) {
    return String(value == null ? "" : value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function cap(s) {
    s = String(s || "");
    return s.charAt(0).toUpperCase() + s.slice(1);
  }

  function labelOf(cls) {
    return CLASS_META[cls] ? CLASS_META[cls].label : cap(cls);
  }

  function setText(id, text) {
    const el = $(id);
    if (el) el.textContent = text;
  }

  function setHtml(id, html) {
    const el = $(id);
    if (el) el.innerHTML = html;
  }

  function mulberry32(seed) {
    let a = seed >>> 0;
    return function () {
      a = (a + 0x6d2b79f5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function normalizeProbs(obj) {
    const entries = Object.entries(obj || {}).filter(([, v]) => typeof v === "number" && isFinite(v));
    const sum = entries.reduce((a, [, v]) => a + v, 0);
    const scale = sum <= 1.5 ? 100 : 1; // 0-1 scale -> percent
    const out = {};
    entries.forEach(([k, v]) => { out[String(k).toLowerCase()] = v * scale; });
    return out;
  }

  // ---------------------------------------------------------------------
  // Toasts
  // ---------------------------------------------------------------------
  function showToast(message, type = "info") {
    const container = $("toastContainer");
    if (!container) return;
    const toast = document.createElement("div");
    toast.className = `toast toast-${type}`;
    toast.textContent = message;
    container.appendChild(toast);
    setTimeout(() => {
      toast.style.opacity = "0";
      setTimeout(() => toast.remove(), 250);
    }, 4200);
  }

  // ---------------------------------------------------------------------
  // Theme
  // ---------------------------------------------------------------------
  function applyTheme(theme) {
    if (theme === "light") {
      document.documentElement.setAttribute("data-theme", "light");
      setText("themeLabel", "Dark Mode");
      localStorage.setItem(THEME_KEY, "light");
    } else {
      document.documentElement.removeAttribute("data-theme");
      setText("themeLabel", "Light Mode");
      localStorage.setItem(THEME_KEY, "dark");
    }
  }

  applyTheme(localStorage.getItem(THEME_KEY) || "dark");

  $("themeToggleBtn").addEventListener("click", () => {
    const next = document.documentElement.getAttribute("data-theme") === "light" ? "dark" : "light";
    applyTheme(next);
    showToast(`Switched to ${next} mode`, "info");
  });

  // ---------------------------------------------------------------------
  // Illustrative placeholder cases (generated pictures, NOT patient data)
  // ---------------------------------------------------------------------
  const PLACEHOLDER_DEFS = [
    {
      id: "ILL-001", seed: 11, kind: "benign",
      title: "Smooth oval lesion",
      point: "Look at the margin: smooth and well-circumscribed edges, with brighter tissue behind the lesion (posterior enhancement), are features learners often review."
    },
    {
      id: "ILL-002", seed: 23, kind: "malignant",
      title: "Irregular margin",
      point: "Look at the margin: an irregular outline with darker tissue behind the lesion (posterior shadowing) is another feature learners often review."
    },
    {
      id: "ILL-003", seed: 37, kind: "benign",
      title: "Small round lesion",
      point: "Compare size and shape: small, round, and smooth. Notice how the annotation hugs the edge."
    },
    {
      id: "ILL-004", seed: 41, kind: "malignant",
      title: "Angular margin",
      point: "Look for corners and angles in the outline. Compare how the annotation follows the uneven edge."
    },
    {
      id: "ILL-005", seed: 59, kind: "benign",
      title: "Wider-than-tall oval",
      point: "Notice the orientation: the lesion is wider than it is tall, lying parallel to the skin surface."
    },
    {
      id: "ILL-006", seed: 73, kind: "malignant",
      title: "Ill-defined edges",
      point: "Notice how hard the edge is to place. When edges are fuzzy, different annotators may draw slightly different outlines."
    }
  ];

  function buildPhantom(def) {
    const W = 512;
    const H = 384;
    const rnd = mulberry32(def.seed);
    const benign = def.kind === "benign";

    const cx = W * (0.36 + rnd() * 0.28);
    const cy = H * (0.42 + rnd() * 0.18);
    const rx = 34 + rnd() * 30;
    const ry = rx * (benign ? 0.58 + rnd() * 0.14 : 0.72 + rnd() * 0.2);
    const harmonics = benign
      ? [[2, 0.03], [3, 0.02]]
      : [[3, 0.16], [5, 0.12], [7, 0.08], [9, 0.05]];
    const phases = harmonics.map(() => rnd() * Math.PI * 2);

    const radiusAt = theta => {
      let m = 1;
      harmonics.forEach(([k, a], i) => { m += a * Math.sin(k * theta + phases[i]); });
      return m;
    };

    const canvas = document.createElement("canvas");
    canvas.width = W;
    canvas.height = H;
    const ctx = canvas.getContext("2d");
    const img = ctx.createImageData(W, H);
    const d = img.data;

    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const depth = y / H;
        let base = 78 - 44 * depth + 10 * Math.sin(y * 0.09 + 1.3);
        if (y < 16) base += 70 * (1 - y / 16); // skin line
        const edgeFade = 1 - Math.pow(Math.abs(x / W - 0.5) * 2, 3) * 0.5;
        const speckle = -Math.log(1 - rnd() * 0.999);
        let v = base * edgeFade * (0.45 + 0.42 * speckle);

        const dx = (x - cx) / rx;
        const dy = (y - cy) / ry;
        const rho = Math.hypot(dx, dy);
        const lim = radiusAt(Math.atan2(dy, dx));
        const t = rho / lim;
        if (t < 1.08) {
          const soft = Math.min(1, Math.max(0, (1.08 - t) / 0.16));
          v = v * (1 - soft) + v * 0.26 * soft;
        }

        // posterior features below the lesion
        if (y > cy + ry && Math.abs(x - cx) < rx * 0.95) {
          const fall = Math.max(0, 1 - (y - (cy + ry)) / (H * 0.4));
          v *= benign ? 1 + 0.35 * fall : 1 - 0.45 * fall;
        }

        v = Math.max(0, Math.min(255, v));
        const idx = (y * W + x) * 4;
        d[idx] = v;
        d[idx + 1] = v;
        d[idx + 2] = v;
        d[idx + 3] = 255;
      }
    }
    ctx.putImageData(img, 0, 0);
    const imageUrl = canvas.toDataURL("image/png");

    // Annotation overlay: outline + soft fill on a transparent canvas of equal size
    const ann = document.createElement("canvas");
    ann.width = W;
    ann.height = H;
    const actx = ann.getContext("2d");
    actx.beginPath();
    const steps = 180;
    for (let i = 0; i <= steps; i++) {
      const phi = (i / steps) * Math.PI * 2;
      const r = radiusAt(phi);
      const px = cx + rx * r * Math.cos(phi);
      const py = cy + ry * r * Math.sin(phi);
      if (i === 0) actx.moveTo(px, py); else actx.lineTo(px, py);
    }
    actx.closePath();
    actx.fillStyle = "rgba(255, 127, 110, 0.22)";
    actx.fill();
    actx.lineWidth = 3;
    actx.strokeStyle = ANNOTATION_COLOR;
    actx.stroke();

    return {
      id: def.id,
      title: def.title,
      source: "illustrative",
      imageUrl,
      annotationUrl: ann.toDataURL("image/png"),
      refLabel: def.kind,
      refNote: "Illustrative reference label for the demo flow — not a real patient outcome.",
      point: def.point,
      filename: `${def.id}.png`,
      width: W,
      height: H,
      file: null,
      progress: { inspected: false, annotation: false, model: false, compared: false },
      analysis: null
    };
  }

  // ---------------------------------------------------------------------
  // Case loading (real dataset cases from the API if available)
  // ---------------------------------------------------------------------
  function resolveUrl(u) {
    if (!u) return null;
    try { return new URL(u, API_BASE + "/").href; } catch (e) { return u; }
  }

  async function loadCases() {
    let cases = null;
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 4000);
      const res = await fetch(`${API_BASE}/api/cases`, { signal: ctrl.signal });
      clearTimeout(timer);
      if (res.ok) {
        const data = await res.json();
        const list = Array.isArray(data) ? data : data && data.cases;
        if (Array.isArray(list) && list.length > 0) {
          cases = list.map((c, i) => ({
            id: String(c.id || `CASE-${i + 1}`),
            title: c.title || `Case ${c.id || i + 1}`,
            source: "dataset",
            imageUrl: resolveUrl(c.image),
            annotationUrl: resolveUrl(c.annotation_mask),
            refLabel: c.reference_label ? String(c.reference_label).toLowerCase() : null,
            refNote: c.reference_note || "Label supplied by the source dataset for this case. It is not a diagnosis.",
            point: c.description || "Compare the scan, the expert annotation, and the model mask.",
            filename: c.filename || String(c.image || "").split("/").pop() || `${c.id}.png`,
            width: null,
            height: null,
            file: null,
            progress: { inspected: false, annotation: false, model: false, compared: false },
            analysis: null
          }));
        }
      }
    } catch (e) {
      /* API offline or endpoint not implemented: fall back to placeholders */
    }

    if (cases) {
      state.cases = cases;
      state.caseSource = "dataset";
    } else {
      state.cases = PLACEHOLDER_DEFS.map(buildPhantom);
      state.caseSource = "illustrative";
    }
  }

  function findCase(id) {
    return state.cases.find(c => c.id === id) || null;
  }

  // ---------------------------------------------------------------------
  // Model status
  // ---------------------------------------------------------------------
  function describeModel() {
    const m = state.model;
    if (!m.online) {
      return {
        key: "offline",
        trusted: false,
        short: "API offline",
        bar: "API OFFLINE · VIEW ONLY",
        notice: "<strong>Demo-only — model API offline.</strong> You can still explore the scan and the dataset annotation. No model output is available."
      };
    }
    if (!m.loaded) {
      return {
        key: "noweights",
        trusted: false,
        short: "No trained checkpoint",
        bar: "NO CHECKPOINT · DEMO ONLY",
        notice: "<strong>Demo-only — no trained checkpoint is loaded.</strong> Any label the model returned would be simulated, so none is shown. The dataset annotation is still available."
      };
    }
    if (!m.compatible) {
      const seen = m.classes.length ? m.classes.join(", ") : "none reported";
      return {
        key: "mismatch",
        trusted: false,
        short: "Checkpoint mismatch",
        bar: "CHECKPOINT MISMATCH · DEMO ONLY",
        notice: `<strong>Demo-only — checkpoint does not match this task.</strong> The model reports classes (${esc(seen)}) instead of the BUSI classes normal / benign / malignant, so its output is not shown.`
      };
    }
    if (m.mode !== "trained" && m.mode !== "trained-baseline") {
      return {
        key: "demo",
        trusted: false,
        short: `Mode: ${m.mode}`,
        bar: "DEMO MODE · NO OUTPUT SHOWN",
        notice: `<strong>Demo-only — the API reports mode “${esc(m.mode)}”.</strong> Only a trained checkpoint's output is shown as a prediction.`
      };
    }
    if (m.mode === "trained-baseline") {
      return {
        key: "baseline",
        trusted: true,
        short: "Experimental U-Net baseline",
        bar: "BASELINE READY · EXPERIMENTAL",
        notice: "<strong>Experimental U-Net baseline loaded.</strong> This is not the MaskFormer model from the research paper and is not a diagnosis."
      };
    }
    return {
      key: "ready",
      trusted: true,
      short: "Trained checkpoint",
      bar: "MODEL READY (EXPERIMENTAL)",
      notice: "<strong>Trained checkpoint reported.</strong> Output is experimental and educational. It is not a diagnosis."
    };
  }

  function canRunModel() {
    const m = state.model;
    return m.online && m.loaded && m.compatible && (m.mode === "trained" || m.mode === "trained-baseline");
  }

  async function checkApiStatus() {
    const t0 = performance.now();
    try {
      const res = await fetch(`${API_BASE}/api/status`, { method: "GET" });
      const elapsed = Math.round(performance.now() - t0);
      if (!res.ok) throw new Error("HTTP " + res.status);
      const data = await res.json();

      const classes = Array.isArray(data.classes) ? data.classes.map(c => String(c).toLowerCase()) : [];
      state.model = {
        online: true,
        loaded: data.model_loaded === true,
        mode: data.mode || (data.model_loaded ? "trained" : "demo"),
        compatible: classes.includes("benign") && classes.includes("malignant"),
        device: data.device || "—",
        classes,
        metrics: data.metrics && typeof data.metrics === "object" ? data.metrics : null
      };
      setText("latencyChip", `${elapsed} ms`);
    } catch (e) {
      state.model = { online: false, loaded: false, mode: "unknown", compatible: false, device: "—", classes: [], metrics: null };
      setText("latencyChip", "—");
    }
    renderStatusDependents();
  }

  function renderStatusDependents() {
    const info = describeModel();
    const dot = $("systemStatusDot");
    if (dot) dot.className = `status-indicator ${info.trusted ? "online" : "offline"}`;
    setText("systemStatusText", info.bar);
    setText("sidebarModelState", info.short);
    setText("sidebarDeviceName", state.model.device);

    setText("overviewModelState", info.short);
    setText("overviewModelNote", info.trusted
      ? "A trained checkpoint is loaded. Output is experimental."
      : "Model output is hidden unless a trained checkpoint answers.");

    renderWorkspaceModelPanel();
    renderClassification();
    renderSources();
  }

  // ---------------------------------------------------------------------
  // Tab navigation
  // ---------------------------------------------------------------------
  const TAB_TITLES = {
    overview: "Overview",
    library: "Case Library",
    simulator: "Probe Simulator",
    practice: "Practice Lab",
    workspace: "Ultrasound Workspace",
    classification: "Classification",
    explainability: "Explainability",
    history: "History / Reports",
    sources: "Sources & Ethics",
    chat: "AI Learning Guide"
  };

  function switchTab(tabId, opts = {}) {
    if (!TAB_TITLES[tabId]) return;
    state.activeTab = tabId;

    document.querySelectorAll(".sidebar-item[data-tab]").forEach(el => {
      const active = el.getAttribute("data-tab") === tabId;
      el.classList.toggle("active", active);
      if (active) el.setAttribute("aria-current", "page"); else el.removeAttribute("aria-current");
    });
    const moreTools = document.querySelector(".sidebar-more-tools details");
    if (moreTools) moreTools.open = ["simulator", "classification", "explainability", "history", "sources"].includes(tabId);

    document.querySelectorAll(".tab-view").forEach(view => {
      view.classList.toggle("active", view.id === `view-${tabId}`);
    });

    document.title = `${TAB_TITLES[tabId]} — EchoAtlas`;

    if (tabId === "overview") renderOverview();
    if (tabId === "library") renderLibrary();
    if (tabId === "practice") renderPractice();
    if (tabId === "workspace") renderWorkspace();
    if (tabId === "classification") {
      const c = state.currentCase;
      if (c && c.analysis) { c.progress.compared = true; renderJourney(); }
      renderClassification();
    }
    if (tabId === "explainability") renderExplain();
    if (tabId === "history") { renderHistory(); renderReport(); }
    if (tabId === "sources") renderSources();
    if (tabId === "chat") { refreshChatStatus(); renderChat(); }
    renderGuidedTour();

    if (opts.focus !== false) {
      const heading = document.querySelector(`#view-${tabId} h1`);
      if (heading) {
        if (!heading.hasAttribute("tabindex")) heading.setAttribute("tabindex", "-1");
        heading.focus({ preventScroll: true });
      }
      const main = $("mainContent");
      if (main) main.scrollTop = 0;
    }
  }

  const GUIDED_TOUR_STEPS = [
    { tab: "library", title: "Choose a case", description: "Pick any example below. Public dataset cases have a reference label; it is for learning, not diagnosis." },
    { tab: "workspace", title: "Explore the scan", description: "Look closely at the image. Try zoom or brightness, then continue when you’re ready." },
    { tab: "workspace", title: "Reveal the dataset annotation", description: "This outline comes from the dataset. It is separate from anything the AI predicts." },
    { tab: "workspace", title: "Try the experimental model", description: "Run the model to see its experimental output. It may disagree with the dataset label." },
    { tab: "classification", title: "Compare the two labels", description: "Review the dataset reference and model output side by side. Neither is a diagnosis." },
  ];

  function renderGuidedTour() {
    const tour = state.guidedTour;
    const panel = $("guidedTourPanel");
    if (!panel) return;
    panel.hidden = !tour.active;
    if (!tour.active) {
      if (tour.targetEl) tour.targetEl.classList.remove("guided-tour-target");
      tour.targetEl = null;
      return;
    }

    const step = GUIDED_TOUR_STEPS[tour.step];
    const caseData = state.currentCase;
    const currentTab = state.activeTab;
    const expectedTab = step.tab;
    const isExpectedTab = currentTab === expectedTab;
    const title = $("guidedTourTitle");
    const description = $("guidedTourDescription");
    const action = $("guidedTourActionBtn");
    const back = $("guidedTourBackBtn");

    setText("guidedTourProgress", `Step ${tour.step + 1} of ${GUIDED_TOUR_STEPS.length}`);
    $("guidedTourProgressBar").style.width = `${((tour.step + 1) / GUIDED_TOUR_STEPS.length) * 100}%`;
    title.textContent = step.title;
    description.textContent = isExpectedTab
      ? step.description
      : tour.step === 0
        ? "Open the case library to choose an example."
        : tour.step === 4
          ? "Open the comparison view to see the dataset label and model output side by side."
          : "Return to your selected case to continue the walkthrough.";
    back.hidden = tour.step === 0 || tour.busy;
    action.hidden = tour.step === 0 && isExpectedTab;
    action.disabled = tour.busy;

    if (!isExpectedTab) {
      action.textContent = tour.step === 0 ? "Open case library" : tour.step === 4 ? "Compare labels" : "Return to case";
    } else if (tour.step === 1) {
      action.textContent = "Continue";
    } else if (tour.step === 2) {
      action.textContent = caseData && caseData.annotationUrl ? (state.viewer.showAnnotation ? "Continue" : "Show dataset annotation") : "Continue";
      if (!caseData || !caseData.annotationUrl) description.textContent = "This case has no dataset annotation. Some cases do; custom uploads do not.";
    } else if (tour.step === 3) {
      action.textContent = caseData && caseData.analysis ? "Review model output" : canRunModel() ? "Run experimental model" : "Continue without model";
      if (!caseData?.analysis && !canRunModel()) {
        description.textContent = state.model.online
          ? "No compatible trained model is loaded. Continue to review the dataset label; no prediction will be shown."
          : "The model service is offline. Continue to review the dataset label; no prediction will be shown.";
      }
    } else if (tour.step === 4) {
      action.textContent = currentTab === "classification" ? "Finish walkthrough" : "Compare labels";
      if (!caseData?.analysis) description.textContent = "Review the dataset reference. The model output will clearly say if it is unavailable.";
    }

    const targetSelectors = ["#libraryGrid .sample-scan-btn", "#mriViewport", "#toggleAnnotationBtn", canRunModel() ? "#runModelBtn" : ".workspace-right-panel", ".model-lab-grid"];
    const target = isExpectedTab ? document.querySelector(targetSelectors[tour.step]) : null;
    if (tour.targetEl !== target) {
      if (tour.targetEl) tour.targetEl.classList.remove("guided-tour-target");
      tour.targetEl = target;
      tour.scrolledToStep = -1;
      if (target) target.classList.add("guided-tour-target");
    }
    if (target && tour.scrolledToStep !== tour.step) {
      tour.scrolledToStep = tour.step;
      const behavior = window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth";
      window.setTimeout(() => target.scrollIntoView({ behavior, block: "center" }), 80);
    }
  }

  function advanceGuidedTour() {
    const tour = state.guidedTour;
    if (!tour.active || tour.busy) return;
    const step = GUIDED_TOUR_STEPS[tour.step];
    if (state.activeTab !== step.tab) {
      switchTab(step.tab);
      return;
    }
    if (tour.step === 0) return; // selecting a case advances the walkthrough
    if (tour.step === 1) {
      tour.step = 2;
      renderGuidedTour();
      return;
    }
    if (tour.step === 2) {
      const c = state.currentCase;
      if (c && c.annotationUrl && !state.viewer.showAnnotation) $("toggleAnnotationBtn").click();
      tour.step = 3;
      renderGuidedTour();
      return;
    }
    if (tour.step === 3) {
      if (state.currentCase && state.currentCase.analysis) {
        tour.step = 4;
        switchTab("classification");
        return;
      }
      if (canRunModel()) {
        tour.busy = true;
        renderGuidedTour();
        $("runModelBtn").click();
      } else {
        tour.step = 4;
        switchTab("classification");
      }
      return;
    }
    if (tour.step === 4 && state.activeTab !== "classification") {
      switchTab("classification");
      return;
    }
    tour.active = false;
    renderGuidedTour();
    showToast("Walkthrough complete. Explore another case whenever you’re ready.", "success");
  }

  function retreatGuidedTour() {
    const tour = state.guidedTour;
    if (!tour.active || tour.step <= 0 || tour.busy) return;
    tour.step -= 1;
    switchTab(GUIDED_TOUR_STEPS[tour.step].tab);
  }

  $("startGuidedTourBtn").addEventListener("click", () => {
    if (state.guidedTour.targetEl) state.guidedTour.targetEl.classList.remove("guided-tour-target");
    state.guidedTour = { active: true, step: 0, busy: false, targetEl: null, scrolledToStep: -1 };
    switchTab("library");
  });
  $("guidedTourActionBtn").addEventListener("click", advanceGuidedTour);
  $("guidedTourBackBtn").addEventListener("click", retreatGuidedTour);
  $("guidedTourSkipBtn").addEventListener("click", () => {
    state.guidedTour.active = false;
    state.guidedTour.busy = false;
    renderGuidedTour();
  });

  document.addEventListener("click", e => {
    const path = typeof e.composedPath === "function" ? e.composedPath() : [e.target];
    const el = path.find(node => node instanceof Element && node.matches("[data-tab]"));
    if (!el) return;
    e.preventDefault();
    switchTab(el.getAttribute("data-tab"));
  }, true);

  // ---------------------------------------------------------------------
  // AI Learning Guide (server-side Gemini proxy; no credentials in the browser)
  // ---------------------------------------------------------------------
  function cleanAssistantMarkup(value) {
    return String(value || "")
      .replace(/```[\s\S]*?```/g, block => block.replace(/```[^\n]*\n?/g, ""))
      .replace(/\\text\{([^}]+)\}/g, "$1")
      .replace(/\\mathrm\{([^}]+)\}/g, "$1")
      .replace(/\\(?:approx|sim)\b/g, "≈")
      .replace(/\\times\b/g, "×")
      .replace(/\\cdot\b/g, "·")
      .replace(/\\(?:leq|le)\b/g, "≤")
      .replace(/\\(?:geq|ge)\b/g, "≥")
      .replace(/\\rightarrow\b/g, "→")
      .replace(/\$\$?([^$\n]+)\$\$?/g, "$1")
      .replace(/\\\((.*?)\\\)|\\\[(.*?)\\\]/g, (_, inline, display) => inline || display || "")
      .replace(/\\([A-Za-z]+)/g, "$1");
  }

  function appendAssistantInline(target, value) {
    const pattern = /(\*\*[^*]+\*\*|__[^_]+__|`[^`]+`|\*[^*]+\*|\[[^\]]+\]\(https?:\/\/[^\s)]+\))/g;
    let start = 0;
    let match;
    while ((match = pattern.exec(value))) {
      if (match.index > start) target.append(document.createTextNode(value.slice(start, match.index)));
      const token = match[0];
      const link = token.match(/^\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)$/);
      if (link) {
        const anchor = document.createElement("a");
        anchor.textContent = link[1];
        anchor.href = link[2];
        anchor.target = "_blank";
        anchor.rel = "noopener noreferrer";
        target.append(anchor);
      } else if (token.startsWith("**") || token.startsWith("__")) {
        const strong = document.createElement("strong");
        strong.textContent = token.slice(2, -2);
        target.append(strong);
      } else if (token.startsWith("`")) {
        const code = document.createElement("code");
        code.textContent = token.slice(1, -1);
        target.append(code);
      } else {
        const emphasis = document.createElement("em");
        emphasis.textContent = token.slice(1, -1);
        target.append(emphasis);
      }
      start = pattern.lastIndex;
    }
    if (start < value.length) target.append(document.createTextNode(value.slice(start)));
  }

  function renderAssistantAnswer(target, raw) {
    const lines = cleanAssistantMarkup(raw).replace(/\r/g, "").split("\n");
    let i = 0;
    while (i < lines.length) {
      const line = lines[i].trim();
      if (!line || /^\|?\s*:?-{3,}/.test(line)) { i += 1; continue; }
      if (/^#{1,6}\s/.test(line)) {
        const heading = document.createElement("p");
        heading.className = "chat-answer-heading";
        appendAssistantInline(heading, line.replace(/^#{1,6}\s*/, ""));
        target.append(heading);
        i += 1;
        continue;
      }
      const ordered = line.match(/^\d+[.)]\s+(.+)/);
      const bullet = line.match(/^[-*+]\s+(.+)/);
      if (ordered || bullet) {
        const list = document.createElement(ordered ? "ol" : "ul");
        while (i < lines.length) {
          const itemLine = lines[i].trim();
          const item = ordered ? itemLine.match(/^\d+[.)]\s+(.+)/) : itemLine.match(/^[-*+]\s+(.+)/);
          if (!item) break;
          const li = document.createElement("li");
          appendAssistantInline(li, item[1]);
          list.append(li);
          i += 1;
        }
        target.append(list);
        continue;
      }
      const paragraph = document.createElement("p");
      while (i < lines.length && lines[i].trim() && !/^#{1,6}\s|^[-*+]\s+|^\d+[.)]\s+/.test(lines[i].trim())) {
        const plain = lines[i].trim().replace(/^\|\s*/, "").replace(/\s*\|\s*$/, "").replace(/\s*\|\s*/g, " · ");
        if (paragraph.childNodes.length) paragraph.append(document.createTextNode(" "));
        appendAssistantInline(paragraph, plain);
        i += 1;
      }
      if (paragraph.textContent.trim()) target.append(paragraph);
    }
  }

  function renderChat() {
    const messagesEl = $("chatMessages");
    if (!messagesEl) return;
    messagesEl.replaceChildren();
    if (!state.chat.messages.length) {
      const welcome = document.createElement("div");
      welcome.className = "chat-welcome";
      welcome.innerHTML = '<div class="chat-welcome-mark" aria-hidden="true">✦</div><h2>What would you like to learn?</h2><p>Ask about ultrasound, dataset labels, or model masks.</p>';
      messagesEl.appendChild(welcome);
    }
    state.chat.messages.forEach(message => {
      const row = document.createElement("article");
      row.className = `chat-message chat-message-${message.role}`;
      const label = document.createElement("span");
      label.className = "chat-message-label";
      label.textContent = message.role === "user" ? "You" : state.chat.modelLabel;
      row.appendChild(label);
      if (message.imageDataUrl) {
        const image = document.createElement("img");
        image.className = "chat-message-image";
        image.src = message.imageDataUrl;
        image.alt = message.imageName ? `Attached image: ${message.imageName}` : "Attached image";
        row.appendChild(image);
      }
      if (message.figureDataUrl) {
        const figure = document.createElement("img");
        figure.className = "chat-generated-figure";
        figure.src = message.figureDataUrl;
        figure.alt = message.figureAlt || "AI-generated educational diagram";
        row.appendChild(figure);
        const caption = document.createElement("span");
        caption.className = "chat-figure-caption";
        caption.textContent = "AI-generated illustration · for learning only";
        row.appendChild(caption);
      }
      const body = document.createElement("div");
      body.className = "chat-message-body";
      if (message.role === "assistant") renderAssistantAnswer(body, message.text);
      else body.textContent = message.text;
      row.appendChild(body);
      messagesEl.appendChild(row);
    });
    if (state.chat.sending) {
      const pending = document.createElement("div");
      pending.className = "chat-thinking";
      pending.setAttribute("role", "status");
      pending.textContent = state.chat.busyKind === "figure" ? "Gemini is making your learning diagram…" : `${state.chat.modelLabel} is preparing a short reply…`;
      messagesEl.appendChild(pending);
    }
    messagesEl.scrollTop = messagesEl.scrollHeight;
    const attachment = state.chat.attachment;
    $("chatAttachment").hidden = !attachment;
    $("chatImageConsentWrap").hidden = !attachment;
    $("chatImageConsent").checked = Boolean(state.chat.imageConsent && attachment);
    if (attachment) {
      $("chatAttachmentPreview").src = attachment.dataUrl;
      setText("chatAttachmentName", attachment.name);
    }
    $("chatError").hidden = !state.chat.error;
    setText("chatError", state.chat.error);
    const enabled = state.chat.configured && !state.chat.sending;
    const imageAlreadyInChat = state.chat.messages.some(message => Boolean(message.imageDataUrl));
    $("chatInput").disabled = !enabled;
    $("chatSendBtn").disabled = !enabled || Boolean(attachment && !state.chat.imageConsent);
    $("chatUploadBtn").disabled = !enabled || Boolean(attachment) || imageAlreadyInChat;
    $("chatCurrentCaseBtn").disabled = !enabled || Boolean(attachment) || imageAlreadyInChat || !state.currentCase;
    $("chatFigureBtn").disabled = !enabled;
  }

  async function refreshChatStatus() {
    try {
      const response = await fetch(`${API_BASE}/api/assistant/status`);
      if (!response.ok) throw new Error("status unavailable");
      const data = await response.json();
      state.chat.configured = Boolean(data.configured);
      state.chat.modelLabel = data.model_label || "Gemini Learning Guide";
      setText("chatModelStatus", state.chat.configured ? "Connected through the EchoAtlas server" : "Gemini API key not configured yet");
      const notice = $("chatConnectionNotice");
      notice.textContent = state.chat.configured
        ? "Connected. Messages and any attached image are sent to Google Gemini when you press Send."
        : "Not connected yet. Add a Gemini API key to the EchoAtlas server environment, then restart the server.";
      notice.classList.toggle("is-connected", state.chat.configured);
    } catch (error) {
      state.chat.configured = false;
      setText("chatModelStatus", "EchoAtlas server not reachable");
      const notice = $("chatConnectionNotice");
      if (notice) notice.textContent = "Start or reconnect the EchoAtlas server to check the Gemini connection.";
    }
    renderChat();
  }

  async function chatImageDataUrl(file) {
    if (!file || !["image/jpeg", "image/png", "image/webp"].includes(file.type)) throw new Error("Choose a JPG, PNG, or WebP image.");
    if (file.size > 4 * 1024 * 1024) throw new Error("Choose an image smaller than 4 MB.");
    return await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = () => reject(new Error("Could not read that image."));
      reader.readAsDataURL(file);
    });
  }

  function chatContextText(text, c) {
    if (!c) return text;
    const label = c.refLabel ? labelOf(c.refLabel) : "not available (uploaded image)";
    const prediction = c.analysis && c.analysis.trained && c.analysis.prediction
      ? `${labelOf(c.analysis.prediction)} (${Number(c.analysis.confidence || 0).toFixed(1)}%, experimental)`
      : "not run / not available";
    return `${text}\n\nContext from the EchoAtlas learning app (not clinical truth): case ${c.id}; dataset reference label: ${label}; experimental model output: ${prediction}. Keep these sources distinct.`;
  }

  async function submitChat(event) {
    event.preventDefault();
    if (!state.chat.configured || state.chat.sending) return;
    const input = $("chatInput");
    const text = input.value.trim();
    const attachment = state.chat.attachment;
    if (attachment && !state.chat.imageConsent) {
      state.chat.error = "Confirm the image is public or fully de-identified before sending it to Gemini.";
      renderChat();
      $("chatImageConsent").focus();
      return;
    }
    if (!text && !attachment) { input.focus(); return; }
    const userMessage = { role: "user", text: chatContextText(text || "Please explain general visible ultrasound features in this image without diagnosing it.", attachment && attachment.case) };
    if (attachment) { userMessage.imageDataUrl = attachment.dataUrl; userMessage.imageName = attachment.name; }
    state.chat.messages.push(userMessage);
    state.chat.messages = state.chat.messages.slice(-12);
    state.chat.attachment = null;
    state.chat.imageConsent = false;
    state.chat.error = "";
    state.chat.busyKind = "reply";
    input.value = "";
    state.chat.sending = true;
    renderChat();
    const messages = state.chat.messages.map(message => {
      const textContent = message.text || "";
      const content = message.imageDataUrl
        ? [{ type: "text", text: textContent }, { type: "image_url", image_url: { url: message.imageDataUrl } }]
        : textContent;
      return { role: message.role, content };
    });
    try {
      const response = await fetch(`${API_BASE}/api/assistant/chat`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ messages })
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.detail || "The Gemini chat request failed. Please try again.");
      state.chat.modelLabel = data.model || state.chat.modelLabel;
      state.chat.messages.push({ role: "assistant", text: String(data.answer || "") });
      state.chat.messages = state.chat.messages.slice(-12);
    } catch (error) {
      state.chat.error = error.message || "Could not reach the Gemini chat service.";
    } finally {
      state.chat.sending = false;
      renderChat();
      if (state.chat.error) $("chatError").focus?.();
    }
  }

  async function createLearningFigure() {
    if (!state.chat.configured || state.chat.sending) return;
    const topic = $("chatFigureTopic").value;
    const labels = {
      ultrasound: { text: "This illustration shows how sound echoes become a 2D image.", alt: "Diagram of an ultrasound probe, returning echoes, and a 2D image" },
      masks: { text: "This illustration separates a dataset annotation from an experimental AI mask.", alt: "Diagram comparing a dataset annotation and an experimental AI mask" },
      metrics: { text: "This illustration shows how overlap metrics compare two regions.", alt: "Diagram showing the overlap between two regions" },
    };
    state.chat.sending = true;
    state.chat.busyKind = "figure";
    state.chat.error = "";
    renderChat();
    try {
      const response = await fetch(`${API_BASE}/api/assistant/figure`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ topic })
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.detail || "Could not create the diagram.");
      if (!/^data:image\/(png|jpeg|webp);base64,/.test(data.image_data_url || "")) throw new Error("Gemini returned an unsupported image format.");
      state.chat.messages.push({ role: "assistant", text: labels[topic]?.text || "Here is a learning diagram.", figureDataUrl: data.image_data_url, figureAlt: labels[topic]?.alt });
      state.chat.messages = state.chat.messages.slice(-12);
    } catch (error) {
      state.chat.error = error.message || "Could not create the diagram.";
    } finally {
      state.chat.sending = false;
      renderChat();
    }
  }

  $("chatForm").addEventListener("submit", submitChat);
  $("chatFigureBtn").addEventListener("click", createLearningFigure);
  $("chatInput").addEventListener("keydown", event => {
    if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); $("chatForm").requestSubmit(); }
  });
  $("chatUploadBtn").addEventListener("click", () => $("chatFileInput").click());
  $("chatFileInput").addEventListener("change", async event => {
    const file = event.target.files && event.target.files[0];
    event.target.value = "";
    if (!file) return;
    try {
      state.chat.attachment = { name: file.name, dataUrl: await chatImageDataUrl(file), case: null };
      state.chat.imageConsent = false;
      state.chat.error = "";
    } catch (error) { state.chat.error = error.message; }
    renderChat();
  });
  $("chatCurrentCaseBtn").addEventListener("click", async () => {
    const c = state.currentCase;
    if (!c || state.chat.attachment) return;
    try {
      let dataUrl = c.imageUrl;
      if (!dataUrl.startsWith("data:")) {
        const response = await fetch(dataUrl);
        if (!response.ok) throw new Error("Could not load the open case image.");
        const blob = await response.blob();
        if (blob.size > 4 * 1024 * 1024) throw new Error("This case image is over the 4 MB chat limit.");
        dataUrl = await chatImageDataUrl(new File([blob], c.filename || "case-image.png", { type: blob.type || "image/png" }));
      }
      if (dataUrl.length > 5_600_000) throw new Error("This case image is over the 4 MB chat limit.");
      state.chat.attachment = { name: c.filename || c.id, dataUrl, case: c };
      state.chat.imageConsent = false;
      state.chat.error = "";
    } catch (error) { state.chat.error = error.message; }
    renderChat();
  });
  $("chatImageConsent").addEventListener("change", event => {
    state.chat.imageConsent = event.target.checked;
    state.chat.error = "";
    renderChat();
  });
  $("chatRemoveAttachmentBtn").addEventListener("click", () => { state.chat.attachment = null; state.chat.imageConsent = false; renderChat(); });
  $("chatClearBtn").addEventListener("click", () => {
    state.chat.messages = [];
    state.chat.attachment = null;
    state.chat.imageConsent = false;
    state.chat.error = "";
    renderChat();
    $("chatInput").focus();
  });
  $("chatSuggestions").addEventListener("click", event => {
    const button = event.target.closest(".chat-suggestion");
    if (!button) return;
    $("chatInput").value = button.textContent.trim();
    $("chatInput").focus();
  });

  const atlasSearch = $("atlasSearch");
  if (atlasSearch) {
    atlasSearch.addEventListener("input", () => {
      const q = atlasSearch.value.trim().toLowerCase();
      const match = Object.keys(COUNTRY_FOCAL_POINTS).find(c => c.toLowerCase() === q);
      if (match) {
        selectMapCountry(match, true);
      } else {
        renderAtlas(atlasSearch.value);
      }
    });
    atlasSearch.addEventListener("keydown", e => {
      if (e.key === "Enter") {
        const q = atlasSearch.value.trim().toLowerCase();
        const match = Object.keys(COUNTRY_FOCAL_POINTS).find(c => c.toLowerCase() === q);
        if (match) {
          selectMapCountry(match, true);
        }
      }
    });
  }
  const atlasSearchClear = $("atlasSearchClear");
  if (atlasSearchClear) atlasSearchClear.addEventListener("click", () => {
    atlasSearch.value = "";
    state.atlasLocation = "all";
    resetMapZoom();
    renderAtlas("all");
    atlasSearch.focus();
  });

  const mapViewport = $("mapViewport");
  const mapZoomIn = $("mapZoomIn");
  const mapZoomOut = $("mapZoomOut");
  const mapZoomReset = $("mapZoomReset");

  if (mapZoomIn) mapZoomIn.addEventListener("click", () => zoomMap(1.3));
  if (mapZoomOut) mapZoomOut.addEventListener("click", () => zoomMap(1 / 1.3));
  if (mapZoomReset) {
    mapZoomReset.addEventListener("click", () => {
      resetMapZoom();
      renderAtlas("all");
    });
  }

  if (mapViewport) {
    // Wheel zoom centered on cursor
    mapViewport.addEventListener("wheel", e => {
      e.preventDefault();
      const rect = mapViewport.getBoundingClientRect();
      const normX = Math.max(0, Math.min(1, (e.clientX - rect.left) / (rect.width || 1000)));
      const normY = Math.max(0, Math.min(1, (e.clientY - rect.top) / (rect.height || 500)));
      const focalSvgX = normX * 1000;
      const focalSvgY = normY * 500;
      const factor = e.deltaY < 0 ? 1.2 : 1 / 1.2;
      zoomMap(factor, focalSvgX, focalSvgY);
    }, { passive: false });

    // Drag to pan
    let potentialCountryTarget = null;

    mapViewport.addEventListener("pointerdown", e => {
      if (e.target.closest("button")) return;
      const countryEl = e.target.closest("[data-atlas-country]");
      potentialCountryTarget = countryEl ? countryEl.dataset.atlasCountry : null;
      mapState.isDragging = true;
      mapState.dragMoved = false;
      mapState.startX = e.clientX;
      mapState.startY = e.clientY;
      mapState.startPanX = mapState.panX;
      mapState.startPanY = mapState.panY;
    });

    mapViewport.addEventListener("pointermove", e => {
      if (!mapState.isDragging) return;
      const dx = e.clientX - mapState.startX;
      const dy = e.clientY - mapState.startY;
      if (Math.abs(dx) > 4 || Math.abs(dy) > 4) {
        if (!mapState.dragMoved) {
          mapState.dragMoved = true;
          try { mapViewport.setPointerCapture(e.pointerId); } catch (_) {}
        }
      }
      if (!mapState.dragMoved) return;

      const rect = mapViewport.getBoundingClientRect();
      const scaleSvgX = 1000 / (rect.width || 1000);
      const scaleSvgY = 500 / (rect.height || 500);

      const targetPanX = mapState.startPanX + dx * scaleSvgX;
      const targetPanY = mapState.startPanY + dy * scaleSvgY;
      const clamped = clampPan(targetPanX, targetPanY, mapState.scale);
      mapState.panX = clamped.panX;
      mapState.panY = clamped.panY;
      applyMapTransform();
    });

    let lastCountryClickTime = 0;
    function handleCountryClick(countryName) {
      if (!countryName) return;
      const now = Date.now();
      if (now - lastCountryClickTime < 300) return;
      lastCountryClickTime = now;
      selectMapCountry(countryName, true);
    }

    function endDrag(e) {
      if (mapState.isDragging) {
        const wasDrag = mapState.dragMoved;
        mapState.isDragging = false;
        try { mapViewport.releasePointerCapture(e.pointerId); } catch (_) {}
        applyMapTransform();

        if (!wasDrag && potentialCountryTarget) {
          handleCountryClick(potentialCountryTarget);
          potentialCountryTarget = null;
        }
      }
    }
    mapViewport.addEventListener("pointerup", endDrag);
    mapViewport.addEventListener("pointercancel", endDrag);

    // Keyboard navigation when viewport focused
    mapViewport.addEventListener("keydown", e => {
      if (e.key === "+" || e.key === "=") {
        e.preventDefault();
        zoomMap(1.25);
      } else if (e.key === "-" || e.key === "_") {
        e.preventDefault();
        zoomMap(1 / 1.25);
      } else if (e.key === "0" || e.key === "Home") {
        e.preventDefault();
        resetMapZoom();
        renderAtlas("all");
      } else if (e.key === "ArrowLeft") {
        e.preventDefault();
        mapState.panX = Math.min(0, mapState.panX + 50);
        applyMapTransform();
      } else if (e.key === "ArrowRight") {
        e.preventDefault();
        const minPanX = 1000 - 1000 * mapState.scale;
        mapState.panX = Math.max(minPanX, mapState.panX - 50);
        applyMapTransform();
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        mapState.panY = Math.min(0, mapState.panY + 30);
        applyMapTransform();
      } else if (e.key === "ArrowDown") {
        e.preventDefault();
        const minPanY = 500 - 500 * mapState.scale;
        mapState.panY = Math.max(minPanY, mapState.panY - 30);
        applyMapTransform();
      }
    });
  }

  // Click on country shape or marker
  document.addEventListener("click", e => {
    if (mapState.dragMoved) return;
    const countryEl = e.target.closest("[data-atlas-country]");
    if (!countryEl) return;
    const country = countryEl.dataset.atlasCountry;
    if (country) {
      handleCountryClick(country);
    }
  });

  // Enter/Space key on country shape or marker
  document.addEventListener("keydown", e => {
    if (e.key !== "Enter" && e.key !== " ") return;
    const countryEl = e.target.closest("[data-atlas-country]");
    if (!countryEl) return;
    e.preventDefault();
    const country = countryEl.dataset.atlasCountry;
    if (country) {
      handleCountryClick(country);
    }
  });

  const atlasRefreshBtn = $("atlasRefreshBtn");
  if (atlasRefreshBtn) {
    atlasRefreshBtn.addEventListener("click", () => {
      loadAtlasCatalog(true);
    });
  }

  const scanSweepScene = $("scanSweepScene");
  const scanSweepToggle = $("scanSweepToggle");
  const simStepStatus = $("simStepStatus");
  const simStepBack = $("simStepBack");
  const simStepNext = $("simStepNext");
  const simStepMessages = [
    "The probe sends a pulse into the tissue.",
    "Echoes return from tissue boundaries; deeper echoes take longer.",
    "The scanner maps echo timing and strength into a 2D image slice."
  ];
  function setSimulatorStep(step) {
    if (!scanSweepScene) return;
    const nextStep = Math.max(1, Math.min(3, Number(step) || 1));
    scanSweepScene.dataset.simStep = String(nextStep);
    scanSweepScene.classList.remove("sim-step-1", "sim-step-2", "sim-step-3");
    scanSweepScene.classList.add(`sim-step-${nextStep}`);
    scanSweepScene.setAttribute("aria-label", `Step ${nextStep} of 3: ${simStepMessages[nextStep - 1]}`);
    document.querySelectorAll("[data-sim-step-button]").forEach(button => {
      const active = Number(button.dataset.simStepButton) === nextStep;
      button.classList.toggle("active", active);
      if (active) button.setAttribute("aria-current", "step");
      else button.removeAttribute("aria-current");
    });
    if (simStepStatus) simStepStatus.textContent = `Step ${nextStep} of 3 · ${simStepMessages[nextStep - 1]}`;
    if (simStepBack) simStepBack.disabled = nextStep === 1;
    if (simStepNext) {
      simStepNext.disabled = nextStep === 3;
      simStepNext.textContent = nextStep === 3 ? "Image built" : "Next step →";
    }
  }
  document.querySelectorAll("[data-sim-step-button]").forEach(button => {
    button.addEventListener("click", () => setSimulatorStep(button.dataset.simStepButton));
  });
  if (simStepBack) simStepBack.addEventListener("click", () => setSimulatorStep(Number(scanSweepScene?.dataset.simStep) - 1));
  if (simStepNext) simStepNext.addEventListener("click", () => setSimulatorStep(Number(scanSweepScene?.dataset.simStep) + 1));
  if (scanSweepScene && scanSweepToggle) {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      scanSweepScene.classList.remove("scan-sweep-playing");
      scanSweepToggle.setAttribute("aria-pressed", "false");
      scanSweepToggle.textContent = "Animation paused";
      scanSweepToggle.disabled = true;
    } else {
      scanSweepToggle.addEventListener("click", () => {
        const playing = scanSweepToggle.getAttribute("aria-pressed") === "true";
        scanSweepToggle.setAttribute("aria-pressed", String(!playing));
        scanSweepScene.classList.toggle("scan-sweep-playing", !playing);
        scanSweepToggle.textContent = playing ? "Play animation" : "Pause animation";
      });
    }
  }
  const brand = $("brandHomeBtn");
  brand.addEventListener("click", () => switchTab("overview"));
  brand.addEventListener("keydown", e => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      switchTab("overview");
    }
  });

  const skip = $("skipLink");
  skip.addEventListener("click", e => {
    e.preventDefault();
    const main = $("mainContent");
    if (main) main.focus();
  });

  // ---------------------------------------------------------------------
  // Case library & sidebar
  // ---------------------------------------------------------------------
  function refDotClass(label) {
    if (label === "malignant") return "warning";
    if (label === "benign") return "success";
    return "purple";
  }

  function renderSidebarCases() {
    const list = $("sidebarCaseList");
    if (!list) return;
    list.innerHTML = "";
    state.cases.slice(0, 5).forEach(c => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "sidebar-preset-item";
      btn.setAttribute("data-open-case", c.id);
      btn.innerHTML = `
        <span class="preset-dot ${refDotClass(c.refLabel)}" aria-hidden="true"></span>
        <span class="preset-lbl">${esc(c.id)}</span>
        <span class="preset-tag">${esc(c.source === "illustrative" ? "Illustr." : "Dataset")}</span>
      `;
      btn.setAttribute("aria-label", `Open case ${c.id}: ${c.title}`);
      list.appendChild(btn);
    });
  }

  function renderLibrary() {
    const grid = $("libraryGrid");
    if (!grid) return;
    grid.innerHTML = "";

    state.cases.forEach(c => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "sample-scan-btn";
      btn.setAttribute("data-open-case", c.id);
      btn.setAttribute("aria-label", `Open case ${c.id}: ${c.title}. Reference label: ${c.refLabel || "none"}.`);
      const sourceBadge = c.source === "illustrative" ? "Illustrative" : "Public dataset";
      btn.innerHTML = `
        <div class="sample-thumb-wrapper">
          <img class="sample-scan-thumb" src="${esc(c.imageUrl)}" alt="Ultrasound image for ${esc(c.title)}">
          <span class="badge badge-secondary thumb-badge">${esc(sourceBadge)}</span>
        </div>
        <div class="sample-scan-info">
          <span class="sample-name">${esc(c.id)} &middot; ${esc(c.title)}</span>
          <span class="sample-meta mono">Reference label: ${esc(c.refLabel ? labelOf(c.refLabel) : "none")}</span>
          <div class="sample-cta-row">
            <span class="cta-label">Open case</span>
            <span class="cta-arrow" aria-hidden="true">&rarr;</span>
          </div>
        </div>
      `;
      grid.appendChild(btn);
    });

    setText("libraryCountBadge", `${state.cases.length} case${state.cases.length === 1 ? "" : "s"}`);

    if (state.caseSource === "illustrative") {
      setHtml("libraryNote", "<strong>Illustrative placeholder cases:</strong> these six pictures are generated for the demo flow &mdash; they are <strong>not real patient scans</strong>, and their labels and outlines are illustrative. Real BUSI cases appear here when the prepared dataset is available to the API at <code>/api/cases</code>.");
    } else {
      setHtml("libraryNote", "<strong>Public dataset cases:</strong> de-identified BUSI examples served by the API. Labels shown are dataset reference labels, not diagnoses. BUSI provides no reliable patient IDs, so this demo does not claim patient-level separation.");
    }
  }

  document.addEventListener("click", e => {
    const el = e.target.closest("[data-open-case]");
    if (!el) return;
    e.preventDefault();
    const c = findCase(el.getAttribute("data-open-case"));
    if (c) openCase(c);
  });

  // ---------------------------------------------------------------------
  // Upload (own image)
  // ---------------------------------------------------------------------
  const dz = $("dropZone");
  const picker = $("filePickerInput");

  $("browseFileBtn").addEventListener("click", () => picker.click());
  $("changeSelectedFileBtn").addEventListener("click", () => picker.click());
  picker.addEventListener("change", e => {
    if (e.target.files && e.target.files[0]) handleSelectedFile(e.target.files[0]);
  });

  ["dragenter", "dragover"].forEach(evt => {
    dz.addEventListener(evt, e => { e.preventDefault(); dz.classList.add("drag-over"); });
  });
  ["dragleave", "drop"].forEach(evt => {
    dz.addEventListener(evt, e => { e.preventDefault(); dz.classList.remove("drag-over"); });
  });
  dz.addEventListener("drop", e => {
    if (e.dataTransfer.files && e.dataTransfer.files[0]) handleSelectedFile(e.dataTransfer.files[0]);
  });

  function handleSelectedFile(file) {
    if (!file.type || !file.type.startsWith("image/")) {
      showToast("Unsupported file. Please choose a PNG or JPG image.", "error");
      return;
    }
    const reader = new FileReader();
    reader.onload = evt => {
      const dataUrl = evt.target.result;
      const img = new Image();
      img.onload = () => {
        state.pendingUpload = { file, dataUrl, width: img.width, height: img.height };
        $("dropzonePrompt").hidden = true;
        $("dropzonePreviewStage").hidden = false;
        $("stagePreviewImage").src = dataUrl;
        $("stagePreviewImage").alt = `Preview of ${file.name}`;
        setText("stageFilename", file.name);
        setText("stageDimensions", `${img.width} × ${img.height} px`);
        setText("stageFileSize", `${(file.size / 1024).toFixed(1)} KB`);
      };
      img.src = dataUrl;
    };
    reader.readAsDataURL(file);
  }

  $("openUploadBtn").addEventListener("click", () => {
    const up = state.pendingUpload;
    if (!up) return;
    const idNum = state.cases.filter(c => c.source === "upload").length + 1;
    const c = {
      id: `UPL-${String(idNum).padStart(3, "0")}`,
      title: up.file.name,
      source: "upload",
      imageUrl: up.dataUrl,
      annotationUrl: null,
      refLabel: null,
      refNote: "Uploaded image: no dataset reference label.",
      point: "This is your own image. There is no expert annotation or reference label to compare against.",
      filename: up.file.name,
      width: up.width,
      height: up.height,
      file: up.file,
      progress: { inspected: false, annotation: false, model: false, compared: false },
      analysis: null
    };
    state.cases.push(c);
    renderSidebarCases();
    openCase(c);
  });

  // ---------------------------------------------------------------------
  // Opening a case & history
  // ---------------------------------------------------------------------
  function resetViewer() {
    const v = state.viewer;
    v.zoom = 1.0;
    v.brightness = 100;
    v.contrast = 100;
    v.annotationOpacity = 85;
    v.modelOpacity = 70;
    v.showAnnotation = false;
    v.showModel = false;
    v.showDifference = false;
    $("brightnessSlider").value = 100;
    $("contrastSlider").value = 100;
    $("annotationOpacitySlider").value = 85;
    $("modelOpacitySlider").value = 70;
  }

  function openCase(c) {
    state.currentCase = c;
    if (state.guidedTour.active && state.guidedTour.step === 0) state.guidedTour.step = 1;
    resetViewer();
    if (c.analysis && c.analysis.trained && c.analysis.maskUrl) {
      // keep model mask available but hidden until the learner toggles it
    }

    if (!state.history.some(h => h.caseId === c.id)) {
      addHistoryEntry(c, "viewed");
    }
    switchTab("workspace");
  }

  function makeThumb(url) {
    return new Promise(resolve => {
      const img = new Image();
      img.crossOrigin = "anonymous";
      img.onload = () => {
        try {
          const w = 256;
          const h = Math.max(1, Math.round((img.height / img.width) * w));
          const cv = document.createElement("canvas");
          cv.width = w;
          cv.height = h;
          cv.getContext("2d").drawImage(img, 0, 0, w, h);
          resolve(cv.toDataURL("image/jpeg", 0.7));
        } catch (e) {
          resolve(null);
        }
      };
      img.onerror = () => resolve(null);
      img.src = url;
    });
  }

  function addHistoryEntry(c, action, analysis) {
    state.historyCounter += 1;
    const entry = {
      id: `EA-2026-${String(state.historyCounter).padStart(3, "0")}`,
      caseId: c.id,
      title: c.title,
      source: c.source,
      action,
      ts: new Date().toLocaleString(),
      refLabel: c.refLabel,
      trained: !!(analysis && analysis.trained),
      mode: analysis ? analysis.mode : null,
      prediction: analysis && analysis.trained ? analysis.prediction : null,
      confidence: analysis && analysis.trained ? analysis.confidence : null,
      probabilities: analysis && analysis.trained ? analysis.probabilities : null,
      latencyMs: analysis ? analysis.latencyMs : null,
      note: analysis ? analysis.note : null,
      thumb: null
    };
    state.history.unshift(entry);
    if (analysis && analysis.maskUrl) state.maskCache[entry.id] = analysis.maskUrl;
    state.reportEntryId = entry.id;
    saveHistory();

    makeThumb(c.imageUrl).then(t => {
      if (t) {
        entry.thumb = t;
        saveHistory();
        if (state.activeTab === "history") { renderHistory(); renderReport(); }
      }
    });
    return entry;
  }

  function saveHistory() {
    try {
      localStorage.setItem(HISTORY_KEY, JSON.stringify(state.history.slice(0, 30)));
    } catch (e) { /* storage full or unavailable */ }
    setText("overviewSessionCount", String(state.history.length));
  }

  function loadHistory() {
    localStorage.removeItem("neuroscan_studies");
    try {
      const raw = JSON.parse(localStorage.getItem(HISTORY_KEY) || "[]");
      if (Array.isArray(raw)) state.history = raw;
    } catch (e) {
      state.history = [];
    }
    const nums = state.history.map(h => parseInt(String(h.id).split("-").pop(), 10)).filter(n => !isNaN(n));
    state.historyCounter = nums.length ? Math.max(...nums) : 0;
    state.reportEntryId = state.history.length ? state.history[0].id : null;
    setText("overviewSessionCount", String(state.history.length));
  }

  // ---------------------------------------------------------------------
  // Overview: 2D Interactive World Map & Research Dataset Catalog
  // ---------------------------------------------------------------------
  const COUNTRY_FOCAL_POINTS = {
    "United States": { x: 195, y: 145, scale: 2.2 },
    Egypt: { x: 587, y: 167, scale: 2.6 },
    Brazil: { x: 335, y: 325, scale: 2.2 },
    Spain: { x: 490, y: 145, scale: 3.2 },
    Poland: { x: 556, y: 110, scale: 3.2 },
    Netherlands: { x: 514, y: 109, scale: 3.8 },
    "United Kingdom": { x: 494, y: 104, scale: 3.5 },
    China: { x: 800, y: 165, scale: 2.2 },
    "South Korea": { x: 855, y: 150, scale: 3.8 },
    Thailand: { x: 780, y: 215, scale: 3.2 },
    Pakistan: { x: 702, y: 160, scale: 2.8 },
    Iran: { x: 638, y: 152, scale: 2.8 }
  };

  const mapState = {
    scale: 1.0,
    minScale: 1.0,
    maxScale: 4.5,
    panX: 0,
    panY: 0,
    isDragging: false,
    dragMoved: false,
    startX: 0,
    startY: 0,
    startPanX: 0,
    startPanY: 0
  };

  function applyMapTransform() {
    const group = $("mapTransformGroup");
    const viewport = $("mapViewport");
    const indicator = $("mapZoomLevel");
    if (!group) return;

    if (viewport) {
      if (mapState.isDragging) viewport.classList.add("is-dragging");
      else viewport.classList.remove("is-dragging");
    }

    group.style.transformOrigin = "0px 0px";
    group.setAttribute("transform", `translate(${mapState.panX.toFixed(2)}, ${mapState.panY.toFixed(2)}) scale(${mapState.scale.toFixed(3)})`);
    if (indicator) {
      indicator.textContent = `${Math.round(mapState.scale * 100)}%`;
    }
  }

  function clampPan(panX, panY, scale) {
    if (scale <= 1.0) {
      return { panX: 0, panY: 0 };
    }
    // Allow panning so any point from (0,0) to (1000,500) can comfortably reach viewport center (500, 250)
    const minPanX = 500 - 1000 * scale;
    const maxPanX = 500;
    const minPanY = 250 - 500 * scale;
    const maxPanY = 250;
    return {
      panX: Math.min(maxPanX, Math.max(minPanX, panX)),
      panY: Math.min(maxPanY, Math.max(minPanY, panY))
    };
  }

  function zoomMap(factor, focalSvgX = 500, focalSvgY = 250) {
    const oldScale = mapState.scale;
    let newScale = Math.max(mapState.minScale, Math.min(mapState.maxScale, oldScale * factor));
    if (Math.abs(newScale - oldScale) < 0.001) return;

    const ratio = newScale / oldScale;
    let newPanX = focalSvgX - (focalSvgX - mapState.panX) * ratio;
    let newPanY = focalSvgY - (focalSvgY - mapState.panY) * ratio;

    const clamped = clampPan(newPanX, newPanY, newScale);
    mapState.scale = newScale;
    mapState.panX = clamped.panX;
    mapState.panY = clamped.panY;
    applyMapTransform();
  }

  function zoomToCountry(countryName) {
    const focal = COUNTRY_FOCAL_POINTS[countryName];
    if (!focal) return;
    const targetScale = focal.scale || 2.4;
    // Precisely center the country's focal coordinates (focal.x, focal.y) at viewport center (500, 250)
    const targetPanX = 500 - focal.x * targetScale;
    const targetPanY = 250 - focal.y * targetScale;

    mapState.scale = targetScale;
    mapState.panX = targetPanX;
    mapState.panY = targetPanY;
    applyMapTransform();
  }

  function resetMapZoom() {
    mapState.scale = 1.0;
    mapState.panX = 0;
    mapState.panY = 0;
    applyMapTransform();
  }

  function selectMapCountry(countryName, shouldZoom = true) {
    if (!countryName) return;
    const match = Object.keys(COUNTRY_FOCAL_POINTS).find(
      c => c.toLowerCase() === countryName.toLowerCase()
    );
    const finalName = match || countryName;

    // Toggle behavior: If the user clicks the same country again while zoomed in, zoom out to full wide view
    const isCurrentActive = state.atlasLocation && state.atlasLocation.toLowerCase() === finalName.toLowerCase();
    const isZoomedIn = mapState.scale > 1.05;

    if (isCurrentActive && isZoomedIn) {
      // Toggle OFF -> zoom out to worldwide view
      state.atlasLocation = "all";
      const searchInput = $("atlasSearch");
      if (searchInput) searchInput.value = "";
      resetMapZoom();
      renderAtlas("all");
      return;
    }

    // Toggle ON -> zoom in, center on country, and display its datasets
    state.atlasLocation = finalName;
    const searchInput = $("atlasSearch");
    if (searchInput) {
      searchInput.value = finalName;
    }

    if (shouldZoom && COUNTRY_FOCAL_POINTS[finalName]) {
      zoomToCountry(finalName);
    }

    renderAtlas(finalName);
  }

  function renderMapMarkers() {
    const layer = $("mapMarkersLayer");
    if (!layer) return;

    const countryMap = {};
    ATLAS_DATASETS.forEach(d => {
      const c = d.collection_country || d.country;
      if (!c) return;
      if (!countryMap[c]) countryMap[c] = [];
      countryMap[c].push(d);
    });

    const entries = Object.keys(countryMap).map(c => {
      const list = countryMap[c];
      const focal = COUNTRY_FOCAL_POINTS[c] || { x: list[0].map_x || 500, y: list[0].map_y || 250, scale: 2.5 };
      return { country: c, count: list.length, x: focal.x, y: focal.y, datasets: list };
    });

    layer.innerHTML = entries.map(item => {
      const isActive = state.atlasLocation && state.atlasLocation.toLowerCase() === item.country.toLowerCase();
      const labelText = `${item.country} (${item.count})`;
      const badgeW = Math.max(54, labelText.length * 6.5 + 8);
      const badgeX = item.x + 8;
      const badgeY = item.y - 12;

      return `<g class="map-marker ${isActive ? "active" : ""}" data-atlas-country="${esc(item.country)}" data-atlas-location="${esc(item.country)}" tabindex="0" role="button" aria-label="${esc(item.country)}: ${item.count} research datasets. Click to zoom in and view.">
        <circle class="marker-halo" cx="${item.x}" cy="${item.y}" r="8"></circle>
        <circle class="marker-dot" cx="${item.x}" cy="${item.y}" r="4.5"></circle>
        <g transform="translate(${badgeX}, ${badgeY})">
          <rect class="marker-badge-bg" x="0" y="-7" width="${badgeW}" height="14" rx="3"></rect>
          <text class="marker-badge-text" x="${badgeW / 2}" y="0">${esc(labelText)}</text>
        </g>
      </g>`;
    }).join("");
  }

  function renderAtlas(query = "") {
    const summary = $("atlasSummary");
    const list = $("atlasDatasets");
    if (!summary || !list) return;
    const q = String(query).trim().toLowerCase();
    const isAll = q === "all" || (!q && state.atlasLocation === "all");

    const rows = ATLAS_DATASETS.filter(item => {
      if (isAll) return true;
      if (!q) {
        const country = (item.collection_country || item.country || "").toLowerCase();
        return country === state.atlasLocation.toLowerCase();
      }
      const searchable = [
        item.name,
        item.dataset_name,
        item.title,
        item.country,
        item.collection_country,
        item.location,
        item.collection_location,
        item.access,
        item.citation,
        item.provenance_source
      ].filter(Boolean).join(" ").toLowerCase();
      return searchable.includes(q);
    });

    const countries = [...new Set(rows.map(item => item.collection_country || item.country).filter(Boolean))];
    const heading = isAll
      ? "Worldwide Research Catalog (all verified regions)"
      : (q
        ? (countries.length === 1 ? countries[0] : `${countries.length} matching research regions`)
        : state.atlasLocation);

    const activeLabel = $("mapActiveCountryLabel");
    if (activeLabel) {
      if (isAll) {
        activeLabel.textContent = `Worldwide (${countries.length} regions · ${rows.length} datasets)`;
      } else if (countries.length === 1) {
        activeLabel.textContent = `${countries[0]} · ${rows.length} public research ${rows.length === 1 ? "dataset" : "datasets"}`;
      } else if (countries.length > 1) {
        activeLabel.textContent = `${countries.length} regions (${rows.length} datasets)`;
      } else {
        activeLabel.textContent = "Worldwide Research Map";
      }
    }

    summary.innerHTML = rows.length
      ? `<strong>${esc(heading)}</strong><span>${rows.length} verified ${rows.length === 1 ? "dataset" : "datasets"} · publication- and source-reported counts listed per dataset (not summed)</span>`
      : `<strong>No catalog match</strong><span>Try searching BUSI, BUS-BRA, UDIAT, OASBUD, BrEaST, China, Poland, Egypt, or Spain.</span>`;

    list.innerHTML = rows.map(item => {
      const isLoaded = item.loaded && state.caseSource === "dataset";
      const inAppCount = isLoaded ? state.cases.length : null;
      const countLabel = item.image_count != null ? item.image_count.toLocaleString() : (item.images != null ? item.images.toLocaleString() : "Unknown");
      const countType = item.count_type ? `(${esc(item.count_type)})` : "(reported sample count)";
      const sourceUrl = item.source_url || item.href;
      const pubUrl = item.publication_url;
      const locationText = item.collection_location || item.location;
      const countryText = item.collection_country || item.country;

      return `<article class="atlas-dataset-card" tabindex="0" aria-label="${esc(item.name)} dataset details">
        <div class="atlas-card-head">
          <div>
            <strong>${esc(item.name)}</strong>
            <span style="font-size:0.75rem; color:var(--text-secondary); display:block; margin-top:2px;">${esc(item.dataset_name || item.title || "")}</span>
          </div>
          <span class="atlas-card-badge ${item.loaded ? "loaded" : ""}">${item.loaded ? "Loaded in EchoAtlas" : "Catalog metadata"}</span>
        </div>

        <div class="atlas-meta-grid">
          <div class="atlas-meta-row">
            <span class="atlas-meta-label">Source facility:</span>
            <span class="atlas-meta-val">${locationText && locationText !== "unknown" ? esc(locationText) : "<em>Unstated in source documentation</em>"}</span>
          </div>
          <div class="atlas-meta-note">Institutional research site · not individual patient locations</div>

          <div class="atlas-meta-row">
            <span class="atlas-meta-label">Country:</span>
            <span class="atlas-meta-val">${esc(countryText || "Unknown")}</span>
          </div>

          <div class="atlas-meta-row">
            <span class="atlas-meta-label">Reported samples:</span>
            <span class="atlas-meta-val"><strong>${countLabel}</strong> ${esc(item.sample_unit || "images")} ${countType}</span>
          </div>
          ${item.cohort_details ? `<div class="atlas-meta-note">${esc(item.cohort_details)}</div>` : ""}

          <div class="atlas-meta-row">
            <span class="atlas-meta-label">Access &amp; license:</span>
            <span class="atlas-meta-val">${esc(item.access || "Documented at source")}</span>
          </div>
        </div>

        <div class="atlas-links">
          ${sourceUrl ? `<a href="${esc(sourceUrl)}" class="atlas-link" target="_blank" rel="noopener noreferrer" aria-label="Open ${esc(item.name)} official dataset source (opens in new tab)">Official dataset source ↗</a>` : ""}
          ${pubUrl ? `<a href="${esc(pubUrl)}" class="atlas-link" target="_blank" rel="noopener noreferrer" aria-label="Open ${esc(item.name)} publication DOI (opens in new tab)">Publication / DOI ↗</a>` : ""}
        </div>

        ${item.provenance_source ? `<div class="atlas-card-provenance"><span style="color:var(--text-muted)">Verified source:</span> ${esc(item.provenance_source)}</div>` : ""}
        ${item.loaded ? `<button class="btn-link" type="button" data-tab="library">Browse BUSI example cases in EchoAtlas (${inAppCount != null ? inAppCount : "sample"} loaded) →</button>` : ""}
      </article>`;
    }).join("");

    // Synchronize active highlights on countries and markers
    document.querySelectorAll(".map-country").forEach(elem => {
      const c = elem.dataset.atlasCountry;
      const active = !isAll && (q
        ? countries.some(cnt => cnt && cnt.toLowerCase() === c.toLowerCase())
        : (c && c.toLowerCase() === state.atlasLocation.toLowerCase()));
      elem.classList.toggle("active", Boolean(active));
      elem.setAttribute("aria-pressed", String(Boolean(active)));
    });

    document.querySelectorAll(".map-marker").forEach(elem => {
      const c = elem.dataset.atlasCountry;
      const active = !isAll && (q
        ? countries.some(cnt => cnt && cnt.toLowerCase() === c.toLowerCase())
        : (c && c.toLowerCase() === state.atlasLocation.toLowerCase()));
      elem.classList.toggle("active", Boolean(active));
      elem.setAttribute("aria-pressed", String(Boolean(active)));
    });

    const clear = $("atlasSearchClear");
    if (clear) clear.hidden = !q;
  }

  async function loadAtlasCatalog(forceRefresh = false) {
    const status = $("atlasDataStatus");
    const dot = $("atlasStatusDot");
    const refreshBtn = $("atlasRefreshBtn");
    if (status) status.textContent = forceRefresh ? "Refreshing source catalog…" : "Checking catalog source…";
    if (refreshBtn) refreshBtn.disabled = true;
    try {
      const url = forceRefresh ? `${API_BASE}/api/dataset-atlas?refresh=true` : `${API_BASE}/api/dataset-atlas`;
      const response = await fetch(url, { headers: { Accept: "application/json" } });
      if (!response.ok) throw new Error(`Catalog request returned ${response.status}`);
      const payload = await response.json();
      if (!Array.isArray(payload.datasets) || payload.datasets.length === 0) throw new Error("Catalog response had no dataset entries");
      ATLAS_DATASETS = payload.datasets;
      renderMapMarkers();
      const timeStr = payload.last_checked_at || payload.fetched_at;
      const checkedAt = timeStr ? new Date(timeStr).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }) : "just now";

      if (dot) {
        dot.className = "pulse-dot";
        if (payload.status === "fallback") dot.classList.add("pulse-error");
        else if (payload.status === "cached") dot.classList.add("pulse-cached");
      }

      if (status) {
        if (payload.status === "live") {
          status.textContent = `Live public catalog · checked ${checkedAt}`;
        } else if (payload.status === "cached") {
          status.textContent = `Cached catalog · checked ${checkedAt}`;
        } else {
          status.textContent = `Curated fallback (source unreachable) · checked ${checkedAt}`;
        }
      }
      renderAtlas($("atlasSearch") ? $("atlasSearch").value : "");
    } catch (error) {
      if (dot) dot.className = "pulse-dot pulse-error";
      if (status) status.textContent = "Curated fallback · source could not be refreshed";
      renderMapMarkers();
      renderAtlas($("atlasSearch") ? $("atlasSearch").value : "");
    } finally {
      if (refreshBtn) refreshBtn.disabled = false;
    }
  }

  function modelOutputText(entry) {
    if (entry.action === "viewed") return "—";
    if (entry.trained && entry.prediction) {
      return `${labelOf(entry.prediction)} (${entry.confidence.toFixed(1)}%)`;
    }
    return "Demo-only (no output shown)";
  }

  function renderOverview() {
    setText("overviewCaseCount", String(state.cases.length));
    setText("overviewCaseSource", state.caseSource === "illustrative"
      ? "Illustrative placeholders (not real scans)"
      : "Public dataset cases");
    renderAtlas($("atlasSearch") ? $("atlasSearch").value : "");

    const tbody = $("overviewRecentTbody");
    if (!tbody) return;
    tbody.innerHTML = "";
    if (state.history.length === 0) {
      tbody.innerHTML = `<tr><td colspan="5">No activity yet. Open a case from the library.</td></tr>`;
      return;
    }
    state.history.slice(0, 5).forEach(item => {
      const tr = document.createElement("tr");
      const canOpen = !!findCase(item.caseId);
      tr.innerHTML = `
        <td class="mono"><strong>${esc(item.id)}</strong></td>
        <td>${esc(item.caseId)}</td>
        <td>${item.action === "model" ? "Model run" : "Case opened"}</td>
        <td class="mono">${esc(modelOutputText(item))}</td>
        <td>${canOpen
          ? `<button class="btn-link" type="button" data-open-case="${esc(item.caseId)}">Open &rarr;</button>`
          : `<span class="mono">Not stored</span>`}</td>
      `;
      tbody.appendChild(tr);
    });
  }

  // ---------------------------------------------------------------------
  // Blind case practice (session-only; scored against dataset labels)
  // ---------------------------------------------------------------------
  const practiceState = state.practice;

  function practiceEligibleCases() {
    return state.cases.filter(c => c.source === "dataset" && c.refLabel && c.imageUrl);
  }

  function renderPractice() {
    const c = practiceState.cases[practiceState.index];
    const image = $("practiceImage");
    const empty = $("practiceEmpty");
    const answers = $("practiceAnswers");
    const next = $("practiceNextBtn");
    const inspect = $("practiceWorkspaceBtn");
    const maskWrap = $("practiceMaskWrap");
    if (!c) {
      image.hidden = true;
      maskWrap.hidden = true;
      empty.hidden = false;
      answers.hidden = true;
      next.disabled = true;
      inspect.disabled = true;
      const available = practiceEligibleCases().length;
      const title = empty.querySelector("strong");
      const note = empty.querySelector("span");
      const start = $("practiceStartBtn");
      if (practiceState.cases.length && practiceState.index >= practiceState.cases.length) {
        if (title) title.textContent = "Round complete";
        if (note) note.textContent = `You matched ${practiceState.matches} of ${practiceState.cases.length} dataset reference labels. These are labels from BUSI, not clinical ground truth or diagnostic feedback.`;
        if (start) start.textContent = "Play another round";
      } else {
        if (title) title.textContent = available ? "Start a guided practice round" : "Public cases are not loaded yet";
        if (note) note.textContent = available
          ? "We’ll show one public BUSI case at a time and keep its reference label hidden until you make your selection."
          : "Practice needs public BUSI cases from the local backend. Start the app with the dataset prepared, then refresh this page.";
        if (start) start.textContent = available ? "Start practice round" : "Cases unavailable";
        if (start) start.disabled = !available;
      }
      setText("practiceCaseCount", "No active case");
      setText("practiceScore", `${practiceState.matches} / ${practiceState.index}`);
      setText("practiceFeedback", "");
      $("practiceFeedback").hidden = true;
      return;
    }

    empty.hidden = true;
    image.hidden = false;
    image.src = c.imageUrl;
    image.alt = "BUSI breast ultrasound practice image; dataset reference label hidden";
    setText("practiceCaseCount", `CASE ${practiceState.index + 1} / ${practiceState.cases.length}`);
    setText("practiceScore", `${practiceState.matches} / ${practiceState.answered ? practiceState.index + 1 : practiceState.index}`);
    answers.hidden = practiceState.answered;
    answers.querySelectorAll("[data-practice-answer]").forEach(button => { button.disabled = practiceState.answered; });
    next.disabled = !practiceState.answered;
    next.textContent = practiceState.index === practiceState.cases.length - 1 ? "Finish round" : "Next case";
    inspect.disabled = !practiceState.answered;
    maskWrap.hidden = !practiceState.answered || !c.annotationUrl;
    if (!maskWrap.hidden) $("practiceMask").src = c.annotationUrl;
    const feedback = $("practiceFeedback");
    feedback.hidden = !practiceState.answered;
    if (practiceState.answered) {
      const choice = practiceState.choice;
      const matched = choice === c.refLabel.toLowerCase();
      feedback.className = `practice-feedback ${matched ? "is-match" : "is-mismatch"}`;
      feedback.textContent = `${matched ? "Your selection matches" : "Your selection differs from"} the BUSI dataset reference label: ${labelOf(c.refLabel)}. This is an educational dataset comparison, not a diagnosis.`;
    }
  }

  function startPracticeRound() {
    const eligible = practiceEligibleCases().slice();
    for (let i = eligible.length - 1; i > 0; i -= 1) {
      const j = Math.floor(Math.random() * (i + 1));
      [eligible[i], eligible[j]] = [eligible[j], eligible[i]];
    }
    practiceState.cases = eligible;
    practiceState.index = 0;
    practiceState.matches = 0;
    practiceState.answered = false;
    practiceState.choice = null;
    renderPractice();
    const firstAnswer = $("practiceAnswers").querySelector("[data-practice-answer]");
    if (firstAnswer) firstAnswer.focus({ preventScroll: true });
  }

  $("practiceStartBtn").addEventListener("click", startPracticeRound);
  $("practiceAnswers").addEventListener("click", event => {
    const button = event.target.closest("[data-practice-answer]");
    const c = practiceState.cases[practiceState.index];
    if (!button || !c || practiceState.answered) return;
    practiceState.choice = button.dataset.practiceAnswer;
    practiceState.answered = true;
    if (practiceState.choice === c.refLabel.toLowerCase()) practiceState.matches += 1;
    renderPractice();
    $("practiceNextBtn").focus({ preventScroll: true });
  });
  $("practiceNextBtn").addEventListener("click", () => {
    if (!practiceState.answered) return;
    practiceState.index += 1;
    practiceState.answered = false;
    practiceState.choice = null;
    renderPractice();
  });
  $("practiceWorkspaceBtn").addEventListener("click", () => {
    const c = practiceState.cases[practiceState.index];
    if (c && practiceState.answered) openCase(c);
  });

  // ---------------------------------------------------------------------
  // Workspace
  // ---------------------------------------------------------------------
  const viewerImg = $("viewerImage");
  const annLayer = $("annotationLayer");
  const maskLayer = $("modelMaskLayer");
  const maskDifferenceLayer = $("maskDifferenceLayer");
  let maskDifferenceCacheKey = null;

  function differenceKey(c) {
    return c && c.analysis && c.analysis.trained
      ? `${c.id}:${c.analysis.ts}:${c.annotationUrl || ""}`
      : null;
  }

  function currentMaskUrl() {
    const c = state.currentCase;
    return c && c.analysis && c.analysis.trained ? c.analysis.maskUrl : null;
  }

  function syncOverlays() {
    if (!viewerImg.naturalWidth) return;
    const w = viewerImg.clientWidth;
    const h = viewerImg.clientHeight;
    [annLayer, maskLayer].forEach(el => {
      el.style.width = `${w}px`;
      el.style.height = `${h}px`;
      el.style.maxWidth = "none";
      el.style.maxHeight = "none";
    });
    maskDifferenceLayer.style.width = `${w}px`;
    maskDifferenceLayer.style.height = `${h}px`;
    maskDifferenceLayer.style.maxWidth = "none";
    maskDifferenceLayer.style.maxHeight = "none";
  }

  viewerImg.addEventListener("load", () => {
    syncOverlays();
    setText("hudDimText", `${viewerImg.naturalWidth} × ${viewerImg.naturalHeight} px`);
  });
  window.addEventListener("resize", syncOverlays);

  function applyViewerTransforms() {
    const v = state.viewer;
    const transform = `scale(${v.zoom})`;
    viewerImg.style.transform = transform;
    viewerImg.style.filter = `brightness(${v.brightness}%) contrast(${v.contrast}%)`;

    annLayer.style.transform = transform;
    annLayer.style.opacity = v.showAnnotation && !v.showDifference ? v.annotationOpacity / 100 : 0;
    maskLayer.style.transform = transform;
    maskLayer.style.opacity = v.showModel && !v.showDifference ? v.modelOpacity / 100 : 0;
    maskDifferenceLayer.style.transform = transform;
    maskDifferenceLayer.style.display = v.showDifference ? "block" : "none";
    maskDifferenceLayer.style.opacity = v.showDifference ? "0.92" : "0";

    setText("hudZoomText", `ZOOM: ${Math.round(v.zoom * 100)}%`);

    const annBtn = $("toggleAnnotationBtn");
    const mskBtn = $("toggleModelBtn");
    annBtn.classList.toggle("active", v.showAnnotation);
    annBtn.setAttribute("aria-pressed", String(v.showAnnotation));
    mskBtn.classList.toggle("active", v.showModel);
    mskBtn.setAttribute("aria-pressed", String(v.showModel));
    const diffBtn = $("toggleMaskDifferenceBtn");
    diffBtn.classList.toggle("active", v.showDifference);
    diffBtn.setAttribute("aria-pressed", String(v.showDifference));
    diffBtn.textContent = v.showDifference ? "Hide mask difference lens" : "Show mask difference lens";
  }

  function loadMaskImage(src) {
    return new Promise((resolve, reject) => {
      const image = new Image();
      image.onload = () => resolve(image);
      image.onerror = () => reject(new Error("A mask image could not be loaded."));
      image.src = src;
    });
  }

  async function renderMaskDifference() {
    const c = state.currentCase;
    const modelUrl = currentMaskUrl();
    if (!c || !c.annotationUrl || !modelUrl || !viewerImg.naturalWidth) {
      throw new Error("This comparison needs a BUSI dataset annotation and an experimental model mask.");
    }
    const width = viewerImg.naturalWidth;
    const height = viewerImg.naturalHeight;
    const [referenceImage, modelImage] = await Promise.all([
      loadMaskImage(c.annotationUrl),
      loadMaskImage(modelUrl)
    ]);
    if (state.currentCase !== c || !maskDifferenceLayer) return;

    const referenceCanvas = document.createElement("canvas");
    const modelCanvas = document.createElement("canvas");
    referenceCanvas.width = modelCanvas.width = width;
    referenceCanvas.height = modelCanvas.height = height;
    const referenceContext = referenceCanvas.getContext("2d", { willReadFrequently: true });
    const modelContext = modelCanvas.getContext("2d", { willReadFrequently: true });
    referenceContext.drawImage(referenceImage, 0, 0, width, height);
    modelContext.drawImage(modelImage, 0, 0, width, height);
    const referencePixels = referenceContext.getImageData(0, 0, width, height).data;
    const modelPixels = modelContext.getImageData(0, 0, width, height).data;

    maskDifferenceLayer.width = width;
    maskDifferenceLayer.height = height;
    const outputContext = maskDifferenceLayer.getContext("2d");
    const output = outputContext.createImageData(width, height);
    let referenceCount = 0;
    let modelCount = 0;
    let intersectionCount = 0;
    for (let pixel = 0, offset = 0; pixel < width * height; pixel += 1, offset += 4) {
      const reference = referencePixels[offset] > 127;
      const prediction = modelPixels[offset] > 127;
      if (reference) referenceCount += 1;
      if (prediction) modelCount += 1;
      if (reference && prediction) {
        intersectionCount += 1;
        output.data[offset] = 77;
        output.data[offset + 1] = 226;
        output.data[offset + 2] = 196;
      } else if (prediction) {
        output.data[offset] = 255;
        output.data[offset + 1] = 183;
        output.data[offset + 2] = 77;
      } else if (reference) {
        output.data[offset] = 255;
        output.data[offset + 1] = 112;
        output.data[offset + 2] = 125;
      } else {
        continue;
      }
      output.data[offset + 3] = 220;
    }
    outputContext.putImageData(output, 0, 0);
    maskDifferenceCacheKey = differenceKey(c);
    const denominator = referenceCount + modelCount;
    const dice = denominator ? (2 * intersectionCount / denominator) : null;
    const union = referenceCount + modelCount - intersectionCount;
    const iou = union ? (intersectionCount / union) : null;
    const legend = $("maskAuditLegend");
    if (legend) legend.hidden = false;
    setText("maskAuditScores", `Dice ${dice == null ? "—" : (dice * 100).toFixed(1) + "%"} · IoU ${iou == null ? "—" : (iou * 100).toFixed(1) + "%"}`);
    setText("maskAuditNote", "Pixel overlap for this case only. Mint marks foreground overlap; amber marks model-only pixels; coral marks dataset-mask-only pixels. This comparison is experimental, not a clinical score or a held-out benchmark.");
  }

  const maskDifferenceButton = $("toggleMaskDifferenceBtn");
  maskDifferenceButton.addEventListener("click", async () => {
    if (state.viewer.showDifference) {
      state.viewer.showDifference = false;
      applyViewerTransforms();
      return;
    }
    maskDifferenceButton.disabled = true;
    setText("maskAuditNote", "Building the per-case mask comparison…");
    try {
      await renderMaskDifference();
      state.viewer.showDifference = true;
      state.viewer.showAnnotation = false;
      state.viewer.showModel = false;
      applyViewerTransforms();
    } catch (error) {
      setText("maskAuditNote", `${error.message} No comparison was shown.`);
      showToast("Mask comparison unavailable for this case.", "error");
    } finally {
      maskDifferenceButton.disabled = !(state.currentCase && state.currentCase.annotationUrl && currentMaskUrl());
    }
  });

  function markInspected() {
    const c = state.currentCase;
    if (c && !c.progress.inspected) {
      c.progress.inspected = true;
      renderJourney();
    }
  }

  function renderJourney() {
    const c = state.currentCase;
    const steps = [
      { id: "jStep1", done: !!c, label: "1. Case selected" },
      { id: "jStep2", done: !!(c && c.progress.inspected), label: "2. Inspect the scan (zoom or adjust)" },
      {
        id: "jStep3",
        done: !!(c && c.progress.annotation),
        label: c && !c.annotationUrl ? "3. Expert annotation (none for this case)" : "3. Compare expert annotation"
      },
      { id: "jStep4", done: !!(c && c.progress.model), label: "4. Run / review model" },
      { id: "jStep5", done: !!(c && c.progress.compared), label: "5. Compare label vs. output" }
    ];
    steps.forEach(s => {
      const el = $(s.id);
      if (!el) return;
      el.className = `timeline-step${s.done ? " done" : ""}`;
      el.querySelector(".step-icon").innerHTML = s.done ? "&check;" : "&bull;";
      el.querySelector(".step-label").textContent = s.label;
    });
  }

  function renderWorkspace() {
    const c = state.currentCase;
    const empty = $("viewerEmptyState");

    if (!c) {
      empty.hidden = false;
      viewerImg.style.display = "none";
      annLayer.style.display = "none";
      maskLayer.style.display = "none";
      setText("caseIdText", "—");
      setText("caseTitleText", "No case selected");
      setText("caseSourceText", "—");
      setText("caseAnnotationText", "—");
      setText("caseRefLabelText", "—");
      setText("caseFileName", "—");
      setText("caseTeachingPoint", "");
      setText("hudSourceText", "—");
      $("caseThumbnail").removeAttribute("src");
      $("caseThumbnail").alt = "";
      $("toggleAnnotationBtn").disabled = true;
      $("toggleModelBtn").disabled = true;
      $("toggleMaskDifferenceBtn").disabled = true;
      $("maskAuditLegend").hidden = true;
      setText("maskAuditNote", "Open a BUSI case, then run the experimental model to compare its mask with the dataset annotation.");
      $("runModelBtn").disabled = true;
      renderJourney();
      renderWorkspaceModelPanel();
      applyViewerTransforms();
      return;
    }

    empty.hidden = true;
    viewerImg.style.display = "block";
    if (viewerImg.getAttribute("src") !== c.imageUrl) viewerImg.src = c.imageUrl;
    viewerImg.alt = `Breast ultrasound image, case ${c.id}: ${c.title}`;

    const isUpload = c.source === "upload";
    const srcLabel = c.source === "illustrative" ? "Illustrative placeholder" : isUpload ? "Custom upload" : "Public dataset";
    $("caseThumbnail").src = c.imageUrl;
    $("caseThumbnail").alt = `Thumbnail of case ${c.id}`;
    setText("caseSourceBadge", c.source === "illustrative" ? "ILLUSTR." : isUpload ? "UPLOAD" : "DATASET");
    setText("caseIdText", c.id);
    setText("caseTitleText", c.title);
    setText("caseSourceText", isUpload ? "Custom image upload" : srcLabel);
    setText("caseAnnotationText", isUpload
      ? "None (custom upload — no expert annotation)"
      : (c.annotationUrl ? (c.source === "illustrative" ? "Illustrative outline (placeholder)" : "Expert annotation available") : "None for this case"));
    setText("caseRefLabelText", isUpload
      ? "None (custom upload — no dataset reference label)"
      : (c.refLabel ? `${labelOf(c.refLabel)} (dataset label)` : "None"));
    setText("caseFileName", c.filename || "—");
    setText("caseTeachingPoint", isUpload
      ? "This is your own image upload. There is no expert annotation or dataset reference label to compare against."
      : (c.point || ""));
    setText("hudSourceText", (isUpload ? "CUSTOM UPLOAD" : srcLabel).toUpperCase());

    // Annotation layer
    if (c.annotationUrl) {
      annLayer.style.display = "block";
      if (annLayer.getAttribute("src") !== c.annotationUrl) annLayer.src = c.annotationUrl;
    } else {
      annLayer.style.display = "none";
      annLayer.removeAttribute("src");
      state.viewer.showAnnotation = false;
    }

    // Model layer
    const maskUrl = currentMaskUrl();
    if (maskUrl) {
      maskLayer.style.display = "block";
      if (maskLayer.getAttribute("src") !== maskUrl) maskLayer.src = maskUrl;
    } else {
      maskLayer.style.display = "none";
      maskLayer.removeAttribute("src");
      state.viewer.showModel = false;
    }

    const annBtn = $("toggleAnnotationBtn");
    if (c.annotationUrl) {
      annBtn.disabled = false;
      annBtn.title = "Toggle dataset annotation (A)";
      annBtn.textContent = "Dataset annotation";
    } else {
      annBtn.disabled = true;
      annBtn.title = isUpload ? "No expert annotation available for custom uploads" : "No dataset annotation for this case";
      annBtn.textContent = isUpload ? "No dataset annotation (upload)" : "No dataset annotation";
    }
    $("toggleModelBtn").disabled = false;
    $("runModelBtn").disabled = false;
    const canCompareMasks = !!(c.source !== "upload" && c.annotationUrl && currentMaskUrl());
    $("toggleMaskDifferenceBtn").disabled = !canCompareMasks;
    if (maskDifferenceCacheKey !== differenceKey(c)) {
      $("maskAuditLegend").hidden = true;
      setText("maskAuditScores", "Dice — · IoU —");
    }
    if (!canCompareMasks) {
      $("maskAuditLegend").hidden = true;
      setText("maskAuditNote", c.source === "upload"
        ? "Custom uploads have no dataset reference mask, so pixel overlap cannot be calculated."
        : !c.annotationUrl
          ? "This case has no dataset annotation mask to compare."
          : "Run the experimental model on this BUSI case to build the mask comparison.");
    } else if ($( "maskAuditLegend").hidden) {
      setText("maskAuditNote", "Build a per-case comparison between the dataset annotation and experimental model mask.");
    }

    renderJourney();
    renderWorkspaceModelPanel();
    applyViewerTransforms();
    syncOverlays();
  }

  function renderWorkspaceModelPanel() {
    const c = state.currentCase;
    const info = describeModel();
    const notice = $("wsModeNotice");
    if (notice) notice.innerHTML = info.notice;

    const chip = $("analysisStatusChip");
    const label = $("analysisStatusLabel");
    const card = $("wsVerdictCard");
    const cmpBox = $("wsComparisonBox");

    if (c) {
      if (c.refLabel) {
        setText("wsRefLabel", `${labelOf(c.refLabel)} (dataset)`);
      } else if (c.source === "upload") {
        setText("wsRefLabel", "None (custom upload)");
      } else {
        setText("wsRefLabel", "None");
      }
    } else {
      setText("wsRefLabel", "—");
    }

    if (!c || !c.analysis) {
      if (label) label.textContent = "Not run";
      if (chip) chip.className = "status-indicator-chip";
      if (card) card.hidden = true;
      setText("wsModelOutput", c ? "Not run yet" : "—");
      if (cmpBox) {
        if (c && c.source === "upload") {
          cmpBox.hidden = false;
          cmpBox.innerHTML = `
            <div class="ws-comparison-alert ws-comparison-upload" role="status">
              <div class="comparison-alert-header">
                <span class="badge badge-secondary">CUSTOM UPLOAD</span>
                <strong>No dataset reference label</strong>
              </div>
              <p>This image has no expert annotation or dataset reference label.</p>
            </div>`;
        } else {
          cmpBox.hidden = true;
          cmpBox.innerHTML = "";
        }
      }
      return;
    }

    const a = c.analysis;
    if (a.trained) {
      if (label) label.textContent = a.mode === "trained-baseline" ? "Experimental U-Net baseline" : "Trained model";
      card.hidden = false;
      setText("wsVerdictName", labelOf(a.prediction));
      const badge = $("wsVerdictBadge");
      badge.className = `verdict-category-badge ${(CLASS_META[a.prediction] || {}).badgeClass || "badge-cyan"}`;
      badge.textContent = "Experimental";
      setText("wsVerdictConf", `${a.confidence.toFixed(1)}%`);
      $("wsVerdictFill").style.width = `${Math.max(0, Math.min(100, a.confidence))}%`;
      setText("wsModelOutput", `${labelOf(a.prediction)} (${a.confidence.toFixed(1)}%)`);

      if (cmpBox) {
        cmpBox.hidden = false;
        if (c.refLabel) {
          const isDisagree = c.refLabel.toLowerCase() !== a.prediction.toLowerCase();
          if (isDisagree) {
            cmpBox.innerHTML = `
              <div class="ws-comparison-alert ws-comparison-disagree" role="status">
                <div class="comparison-alert-header">
                  <span class="badge badge-warning">⚠️ DISAGREEMENT</span>
                  <strong style="color:var(--status-warning, #FFB547);">Dataset ${esc(labelOf(c.refLabel))} &ne; Model ${esc(labelOf(a.prediction))}</strong>
                </div>
                <p>The baseline model predicted a different class than the dataset reference label (${a.confidence.toFixed(1)}% prob). Review the margins in Workspace or see Classification tab.</p>
              </div>`;
          } else {
            cmpBox.innerHTML = `
              <div class="ws-comparison-alert ws-comparison-agree" role="status">
                <div class="comparison-alert-header">
                  <span class="badge badge-success">✓ AGREEMENT</span>
                  <strong style="color:var(--status-success, #32D583);">Reference &amp; model agree: ${esc(labelOf(c.refLabel))}</strong>
                </div>
                <p>Both dataset label and model indicate ${esc(labelOf(c.refLabel))} (${a.confidence.toFixed(1)}%). Agreement does not validate clinical accuracy.</p>
              </div>`;
          }
        } else {
          cmpBox.innerHTML = `
            <div class="ws-comparison-alert ws-comparison-upload" role="status">
              <div class="comparison-alert-header">
                <span class="badge badge-secondary">${c.source === "upload" ? "CUSTOM UPLOAD" : "NO REFERENCE LABEL"}</span>
                <strong>No dataset reference label</strong>
              </div>
              <p>Model predicted ${esc(labelOf(a.prediction))} (${a.confidence.toFixed(1)}%). ${c.source === "upload" ? "No ground-truth label exists for this image." : "No reference label is available for comparison."}</p>
            </div>`;
        }
      }
    } else {
      if (label) label.textContent = "Demo-only";
      card.hidden = true;
      setText("wsModelOutput", "Demo-only — no output shown");
      if (cmpBox) {
        cmpBox.hidden = true;
        cmpBox.innerHTML = "";
      }
    }
  }

  // Viewer controls
  $("zoomInBtn").addEventListener("click", () => zoomBy(0.25));
  $("zoomOutBtn").addEventListener("click", () => zoomBy(-0.25));
  $("zoomFitBtn").addEventListener("click", () => { state.viewer.zoom = 1.0; applyViewerTransforms(); });
  $("resetViewerBtn").addEventListener("click", () => {
    const keepA = state.viewer.showAnnotation;
    const keepM = state.viewer.showModel;
    resetViewer();
    state.viewer.showAnnotation = keepA;
    state.viewer.showModel = keepM;
    applyViewerTransforms();
  });
  $("fullscreenViewerBtn").addEventListener("click", () => {
    const vp = $("mriViewport");
    if (!document.fullscreenElement) {
      vp.requestFullscreen && vp.requestFullscreen().catch(() => {});
    } else {
      document.exitFullscreen && document.exitFullscreen().catch(() => {});
    }
  });

  function zoomBy(delta) {
    state.viewer.zoom = Math.max(0.5, Math.min(3.0, state.viewer.zoom + delta));
    applyViewerTransforms();
    markInspected();
  }

  $("brightnessSlider").addEventListener("input", e => {
    state.viewer.brightness = Number(e.target.value);
    applyViewerTransforms();
    markInspected();
  });
  $("contrastSlider").addEventListener("input", e => {
    state.viewer.contrast = Number(e.target.value);
    applyViewerTransforms();
    markInspected();
  });
  $("annotationOpacitySlider").addEventListener("input", e => {
    state.viewer.annotationOpacity = Number(e.target.value);
    applyViewerTransforms();
  });
  $("modelOpacitySlider").addEventListener("input", e => {
    state.viewer.modelOpacity = Number(e.target.value);
    applyViewerTransforms();
  });

  function toggleAnnotation() {
    const c = state.currentCase;
    if (!c) return;
    if (!c.annotationUrl) {
      showToast("This case has no dataset annotation.", "info");
      return;
    }
    state.viewer.showAnnotation = !state.viewer.showAnnotation;
    if (state.viewer.showAnnotation) c.progress.annotation = true;
    applyViewerTransforms();
    renderJourney();
    if (state.guidedTour.active && state.guidedTour.step === 2 && state.viewer.showAnnotation) {
      state.guidedTour.step = 3;
      renderGuidedTour();
    }
  }

  function toggleModel() {
    const c = state.currentCase;
    if (!c) return;
    if (!currentMaskUrl()) {
      showToast("No model mask yet. Only a trained checkpoint produces one — run the experimental model first.", "info");
      return;
    }
    state.viewer.showModel = !state.viewer.showModel;
    applyViewerTransforms();
  }

  $("toggleAnnotationBtn").addEventListener("click", toggleAnnotation);
  $("toggleModelBtn").addEventListener("click", toggleModel);

  $("panelChangeCaseBtn").addEventListener("click", () => switchTab("library"));
  $("workspaceNewCaseBtn").addEventListener("click", () => switchTab("library"));
  $("goClassificationBtn").addEventListener("click", () => switchTab("classification"));
  $("goExplainBtn").addEventListener("click", () => switchTab("explainability"));
  $("runModelBtn").addEventListener("click", runModel);
  $("clsRunBtn").addEventListener("click", runModel);

  document.addEventListener("keydown", e => {
    if (state.activeTab !== "workspace") return;
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const tag = (e.target.tagName || "").toLowerCase();
    if (tag === "input" || tag === "textarea" || tag === "select") return;

    if (e.key === "+" || e.key === "=") { e.preventDefault(); zoomBy(0.25); }
    else if (e.key === "-" || e.key === "_") { e.preventDefault(); zoomBy(-0.25); }
    else if (e.key === "0") { e.preventDefault(); state.viewer.zoom = 1.0; applyViewerTransforms(); }
    else if (e.key === "a" || e.key === "A") { e.preventDefault(); toggleAnnotation(); }
    else if (e.key === "m" || e.key === "M") { e.preventDefault(); toggleModel(); }
  });

  // ---------------------------------------------------------------------
  // Running the model (honest handling of demo / mismatched output)
  // ---------------------------------------------------------------------
  function setLoadingStep(stepNum) {
    ["lStep1", "lStep2", "lStep3", "lStep4"].forEach((id, idx) => {
      const el = $(id);
      if (!el) return;
      const check = el.querySelector(".step-check");
      if (idx + 1 < stepNum) {
        el.className = "loading-step-item done";
        check.innerHTML = "&check;";
      } else if (idx + 1 === stepNum) {
        el.className = "loading-step-item active";
        check.innerHTML = "&bull;";
      } else {
        el.className = "loading-step-item";
        check.innerHTML = "&bull;";
      }
    });
  }

  function showLoading(show) {
    const modal = $("loadingModal");
    modal.hidden = !show;
    modal.style.display = show ? "flex" : "none";
  }

  async function caseToBlob(c) {
    if (c.file) return c.file;
    const res = await fetch(c.imageUrl);
    return await res.blob();
  }

  async function runModel() {
    const c = state.currentCase;
    if (!c) {
      showToast("Open a case first.", "info");
      switchTab("library");
      return;
    }
    if (!canRunModel()) {
      showToast("No compatible trained model is ready. No prediction was made; the dataset annotation is still available.", "error");
      return;
    }

    if (state.guidedTour.active && state.guidedTour.step === 3) {
      state.guidedTour.busy = true;
      renderGuidedTour();
    }
    showLoading(true);
    const t0 = performance.now();
    const timer = setInterval(() => setText("loadingTimeCounter", `${Math.round(performance.now() - t0)} ms`), 50);
    setLoadingStep(1);

    let analysis;
    try {
      const blob = await caseToBlob(c);
      const form = new FormData();
      form.append("file", blob, c.filename || "case.png");

      setLoadingStep(2);
      const res = await fetch(`${API_BASE}/predict`, { method: "POST", body: form });
      if (!res.ok) throw new Error(`Server returned HTTP ${res.status}`);
      const result = await res.json();

      setLoadingStep(3);
      analysis = interpretResult(result);
    } catch (err) {
      console.warn("Model request failed:", err);
      const statusCode = Number(String(err && err.message || "").match(/HTTP (\d+)/)?.[1] || 0);
      const note = [502, 503, 504].includes(statusCode) || err instanceof TypeError
        ? "The experimental model is temporarily unavailable. No prediction was made. You can still review the dataset label and annotation."
        : "We couldn't run the experimental model. No prediction was made. Please try again in a moment.";
      analysis = {
        ts: new Date().toLocaleString(),
        mode: "error",
        trained: false,
        prediction: null,
        confidence: null,
        probabilities: null,
        maskUrl: null,
        latencyMs: null,
        note
      };
    }

    setLoadingStep(4);
    clearInterval(timer);

    c.analysis = analysis;
    state.viewer.showDifference = false;
    c.progress.model = true;
    addHistoryEntry(c, "model", analysis);

    setTimeout(() => {
      showLoading(false);
      if (state.guidedTour.active && state.guidedTour.step === 3) {
        state.guidedTour.step = 4;
        state.guidedTour.busy = false;
      }
      if (analysis.trained) {
        showToast(`Model output: ${labelOf(analysis.prediction)} (${analysis.confidence.toFixed(1)}%) — experimental, not a diagnosis.`, "success");
      } else {
        showToast("Demo-only: no trained-model prediction is shown for this run.", "info");
      }
      if (state.activeTab === "workspace") renderWorkspace();
      renderClassification();
      renderExplain();
      renderOverview();
      renderGuidedTour();
    }, 250);
  }

  function interpretResult(result) {
    const mode = result && result.mode ? String(result.mode) : "unspecified";
    const pred = String((result && result.prediction) || "").toLowerCase();
    const probs = normalizeProbs(result && result.probabilities);
    const latency = result && typeof result.inference_time_ms === "number" ? result.inference_time_ms : null;

    const trained = (mode === "trained" || mode === "trained-baseline") && !!CLASS_META[pred];

    if (!trained) {
      let reason;
      if (mode !== "trained" && mode !== "trained-baseline") {
        reason = `The API reported mode “${mode}”, not a trained model. To avoid presenting a simulated result as a prediction, the output was discarded.`;
      } else {
        reason = `The returned class “${pred || "none"}” is not a recognized BUSI class, so it was discarded.`;
      }
      return {
        ts: new Date().toLocaleString(),
        mode,
        trained: false,
        prediction: null,
        confidence: null,
        probabilities: null,
        maskUrl: null,
        latencyMs: latency,
        note: reason
      };
    }

    let confidence = probs[pred];
    if (typeof confidence !== "number") {
      const raw = Number(result.confidence);
      confidence = isFinite(raw) ? (raw <= 1 ? raw * 100 : raw) : 0;
    }

    return {
      ts: new Date().toLocaleString(),
      mode,
      trained: true,
      prediction: pred,
      confidence,
      probabilities: probs,
      maskUrl: result.segmentation_mask || null,
      latencyMs: latency,
      note: result.segmentation_mask ? `${mode === "trained-baseline" ? "Experimental U-Net baseline" : "Trained checkpoint"} output; not a diagnosis.` : `${mode === "trained-baseline" ? "Experimental U-Net baseline" : "Trained checkpoint"} output; the API returned no segmentation mask.`
    };
  }

  // ---------------------------------------------------------------------
  // Classification view
  // ---------------------------------------------------------------------
  function renderClassification() {
    const c = state.currentCase;
    const a = c ? c.analysis : null;

    setText("clsCaseTitle", c ? `${c.id} · ${c.title}` : "No case selected");
    if (c) {
      if (c.refLabel) {
        setText("clsRefLabel", labelOf(c.refLabel));
        setText("clsRefNote", c.refNote || "A label supplied by the source dataset for this case. It is not a diagnosis for any person.");
      } else if (c.source === "upload") {
        setText("clsRefLabel", "None (custom upload)");
        setText("clsRefNote", "Custom image upload: This image was provided by the user and does not have an expert annotation or ground-truth reference label.");
      } else {
        setText("clsRefLabel", "None");
        setText("clsRefNote", "No reference label available for this case.");
      }
    } else {
      setText("clsRefLabel", "—");
      setText("clsRefNote", "A label supplied by the source dataset for this case. It is not a diagnosis for any person.");
    }

    const cmpCard = $("clsComparisonCard");
    const cmpBadge = $("clsComparisonBadge");
    const cmpTitle = $("clsComparisonTitle");
    const cmpContent = $("clsComparisonContent");

    const notice = $("clsNotice");
    const badge = $("clsModeBadge");
    const verdict = $("clsVerdictCard");
    const probSection = $("clsProbSection");

    if (!c) {
      badge.textContent = "No case";
      notice.hidden = false;
      notice.innerHTML = "<strong>No case open:</strong> choose a case from the library first.";
      verdict.hidden = true;
      probSection.hidden = true;
      if (cmpCard) cmpCard.hidden = true;
      setText("clsLatency", "—");
      setText("clsMaskState", "—");
    } else if (!a) {
      badge.textContent = "Not run";
      notice.hidden = false;
      notice.innerHTML = `${describeModel().notice}<br><br><strong>No model output yet:</strong> use “Run experimental model”.`;
      verdict.hidden = true;
      probSection.hidden = true;
      if (cmpCard) cmpCard.hidden = true;
      setText("clsLatency", "—");
      setText("clsMaskState", "—");
    } else if (!a.trained) {
      badge.textContent = "Demo-only";
      notice.hidden = false;
      notice.innerHTML = `<strong>Demo-only — no prediction shown.</strong> ${esc(a.note || "")}`;
      verdict.hidden = true;
      probSection.hidden = true;
      if (cmpCard) cmpCard.hidden = true;
      setText("clsLatency", a.latencyMs != null ? `${a.latencyMs} ms` : "—");
      setText("clsMaskState", "No (demo-only)");
    } else {
      badge.textContent = a.mode === "trained-baseline" ? "Experimental U-Net baseline" : "Trained checkpoint";
      notice.hidden = true;
      verdict.hidden = false;
      probSection.hidden = false;

      setText("verdictClassName", labelOf(a.prediction));
      const vb = $("verdictCategoryBadge");
      vb.className = `verdict-category-badge ${(CLASS_META[a.prediction] || {}).badgeClass || "badge-cyan"}`;
      vb.textContent = "Experimental";
      setText("verdictConfidenceVal", `${a.confidence.toFixed(1)}%`);
      $("verdictConfidenceFill").style.width = `${Math.max(0, Math.min(100, a.confidence))}%`;

      let uncertainty;
      if (a.confidence < 60) uncertainty = "Low margin: the model is close to undecided. Treat this as uncertain.";
      else if (a.confidence < 75) uncertainty = "Moderate probability: the model leans one way but is not sure.";
      else uncertainty = "A high probability still does not make this a diagnosis; models trained on small datasets can be overconfident.";

      if (c.refLabel) {
        uncertainty += c.refLabel.toLowerCase() === a.prediction.toLowerCase()
          ? " The model output matches the dataset's reference label for this case — agreement does not validate the model."
          : " The model output differs from the dataset's reference label for this case — a good prompt to inspect the margins in the Ultrasound Workspace.";
      } else if (c.source === "upload") {
        uncertainty += " Custom image upload: No ground-truth label exists to compare with this prediction.";
      }
      setText("uncertaintyNote", uncertainty);

      // Render prominent comparison banner card
      if (cmpCard) {
        cmpCard.hidden = false;
        if (c.refLabel) {
          const isDisagree = c.refLabel.toLowerCase() !== a.prediction.toLowerCase();
          if (isDisagree) {
            cmpBadge.className = "badge badge-warning";
            cmpBadge.textContent = "⚠️ Disagreement detected";
            cmpTitle.textContent = "Dataset Reference vs. Model Output Disagreement";
            cmpContent.innerHTML = `
              <div class="comparison-box-inner comparison-box-disagree">
                <div style="display:flex; flex-wrap:wrap; gap:16px; align-items:center; margin-bottom:12px;">
                  <div style="background:var(--bg-elevated); padding:8px 14px; border-radius:6px; border:1px solid var(--border-color);">
                    <span style="font-size:0.75rem; color:var(--text-muted); display:block;">DATASET REFERENCE LABEL</span>
                  <strong style="font-size:1.15rem; color:var(--accent-cyan);">${esc(labelOf(c.refLabel))}</strong>
                  </div>
                  <div style="font-size:1.5rem; font-weight:700; color:var(--status-warning, #FFB547);">&ne;</div>
                  <div style="background:var(--bg-elevated); padding:8px 14px; border-radius:6px; border:1px solid rgba(255,181,71,0.4);">
                    <span style="font-size:0.75rem; color:var(--text-muted); display:block;">EXPERIMENTAL MODEL PREDICTION</span>
                    <strong style="font-size:1.15rem; color:var(--status-warning, #FFB547);">${esc(labelOf(a.prediction))} (${a.confidence.toFixed(1)}%)</strong>
                  </div>
                </div>
                <p style="margin:0 0 8px 0; color:var(--text-primary); font-weight:600;">
                  ⚠️ The baseline model prediction diverges from the expert dataset reference label.
                </p>
                <p style="margin:0; color:var(--text-secondary); font-size:0.8125rem; line-height:1.55;">
                  <strong>Learning prompt:</strong> The demo cannot explain why the model disagreed. Compare the scan and dataset annotation; a mismatch alone does not show which label is correct. The output is experimental and not a diagnosis.
                </p>
              </div>`;
          } else {
            cmpBadge.className = "badge badge-success";
            cmpBadge.textContent = "✓ Reference & model agree";
            cmpTitle.textContent = "Dataset Reference & Model Output Agreement";
            cmpContent.innerHTML = `
              <div class="comparison-box-inner comparison-box-agree">
                <div style="display:flex; flex-wrap:wrap; gap:16px; align-items:center; margin-bottom:12px;">
                  <div style="background:var(--bg-elevated); padding:8px 14px; border-radius:6px; border:1px solid var(--border-color);">
                    <span style="font-size:0.75rem; color:var(--text-muted); display:block;">DATASET REFERENCE LABEL</span>
                    <strong style="font-size:1.15rem; color:var(--status-success, #32D583);">${esc(labelOf(c.refLabel))}</strong>
                  </div>
                  <div style="font-size:1.5rem; font-weight:700; color:var(--status-success, #32D583);">=</div>
                  <div style="background:var(--bg-elevated); padding:8px 14px; border-radius:6px; border:1px solid rgba(50,213,131,0.4);">
                    <span style="font-size:0.75rem; color:var(--text-muted); display:block;">EXPERIMENTAL MODEL PREDICTION</span>
                    <strong style="font-size:1.15rem; color:var(--status-success, #32D583);">${esc(labelOf(a.prediction))} (${a.confidence.toFixed(1)}%)</strong>
                  </div>
                </div>
                <p style="margin:0 0 8px 0; color:var(--text-primary); font-weight:600;">
                  ✓ Both the dataset reference label and experimental model indicate <strong>${esc(labelOf(c.refLabel))}</strong>.
                </p>
                <p style="margin:0; color:var(--text-secondary); font-size:0.8125rem; line-height:1.55;">
                  <strong>Educational reminder:</strong> Model agreement on this single case does not indicate diagnostic accuracy or validate the model for clinical use. Models trained on limited exploratory splits can be overconfident or memorize artifacts.
                </p>
              </div>`;
          }
        } else {
          cmpBadge.className = "badge badge-secondary";
          const isUpload = c.source === "upload";
          cmpBadge.textContent = isUpload ? "Custom image upload" : "No reference label";
          cmpTitle.textContent = isUpload ? "Custom Upload — No Ground-Truth Comparison" : "No Dataset Reference Label Available";
          cmpContent.innerHTML = `
            <div class="comparison-box-inner comparison-box-upload">
              <div style="display:flex; flex-wrap:wrap; gap:16px; align-items:center; margin-bottom:12px;">
                <div style="background:var(--bg-elevated); padding:8px 14px; border-radius:6px; border:1px solid var(--border-color);">
                  <span style="font-size:0.75rem; color:var(--text-muted); display:block;">DATASET REFERENCE LABEL</span>
                  <strong style="font-size:1.05rem; color:var(--text-secondary);">${isUpload ? "None (custom upload)" : "None available"}</strong>
                </div>
                <div style="background:var(--bg-elevated); padding:8px 14px; border-radius:6px; border:1px solid rgba(105,223,206,0.3);">
                  <span style="font-size:0.75rem; color:var(--text-muted); display:block;">EXPERIMENTAL MODEL PREDICTION</span>
                  <strong style="font-size:1.15rem; color:var(--accent-cyan);">${esc(labelOf(a.prediction))} (${a.confidence.toFixed(1)}%)</strong>
                </div>
              </div>
              <p style="margin:0 0 8px 0; color:var(--text-primary); font-weight:600;">
                ℹ️ ${isUpload ? "This image has no dataset reference label or expert annotation." : "No dataset reference label is available for this case."}
              </p>
              <p style="margin:0; color:var(--text-secondary); font-size:0.8125rem; line-height:1.55;">
                ${isUpload ? `The experimental baseline produced an exploratory prediction of <strong>${esc(labelOf(a.prediction))}</strong> (${a.confidence.toFixed(1)}%). Because this is a user-provided image without ground truth, no comparison against a verified label is possible.` : `The experimental baseline produced an exploratory prediction of <strong>${esc(labelOf(a.prediction))}</strong> (${a.confidence.toFixed(1)}%). There is no dataset reference label available for comparison.`}
              </p>
            </div>`;
        }
      }

      const list = $("probBarsList");
      list.innerHTML = "";
      Object.entries(a.probabilities || {}).sort((x, y) => y[1] - x[1]).forEach(([k, v]) => {
        const meta = CLASS_META[k] || { label: cap(k), color: "#2EC4B6" };
        const row = document.createElement("div");
        row.className = "prob-row";
        row.innerHTML = `
          <div class="prob-row-header">
            <span class="prob-class-name">${esc(meta.label)}</span>
            <span class="prob-class-val mono">${v.toFixed(1)}%</span>
          </div>
          <div class="prob-bar-track">
            <div class="prob-bar-fill" style="width:${Math.max(0, Math.min(100, v))}%; background:${meta.color};"></div>
          </div>
        `;
        list.appendChild(row);
      });

      setText("clsLatency", a.latencyMs != null ? `${a.latencyMs} ms` : "—");
      setText("clsMaskState", a.maskUrl ? "Yes" : "No mask returned");
    }

    renderMetrics();
  }

  function renderMetrics() {
    const grid = $("clsMetricsGrid");
    const badge = $("clsMetricsBadge");
    if (!grid) return;
    const metrics = state.model.metrics;
    grid.innerHTML = "";

    if (!metrics || Object.keys(metrics).length === 0) {
      badge.textContent = "Not reported";
      grid.innerHTML = `
        <div class="bench-stat-box">
          <span class="bench-label">METRICS</span>
          <span class="bench-val mono">&mdash;</span>
          <span class="bench-sub">The model API has not reported held-out metrics yet.</span>
        </div>`;
      return;
    }

    badge.textContent = "Reported by API";
    Object.entries(metrics).forEach(([k, v]) => {
      let shown = v;
      if (typeof v === "number") shown = v <= 1 && v >= 0 ? v.toFixed(3) : String(v);
      const box = document.createElement("div");
      box.className = "bench-stat-box";
      box.innerHTML = `
        <span class="bench-label">${esc(String(k).replace(/_/g, " ").toUpperCase())}</span>
        <span class="bench-val mono">${esc(shown)}</span>
        <span class="bench-sub">Held-out cases</span>`;
      grid.appendChild(box);
    });
  }

  // ---------------------------------------------------------------------
  // Explainability view
  // ---------------------------------------------------------------------
  function renderExplain() {
    const c = state.currentCase;
    const ids = ["exOriginalImg", "exAnnBaseImg", "exModelBaseImg"];

    if (!c) {
      ids.forEach(id => { $(id).removeAttribute("src"); });
      $("exAnnOverlayImg").hidden = true;
      $("exModelOverlayImg").hidden = true;
      const annEmptyInit = $("exAnnEmpty");
      if (annEmptyInit) annEmptyInit.hidden = true;
      setText("exOriginalMeta", "No case open");
      setText("exAnnMeta", "No case open");
      setText("exModelEmpty", "No case open.");
      return;
    }

    ids.forEach(id => { $(id).src = c.imageUrl; });
    $("exOriginalImg").alt = `Original scan, case ${c.id}, no overlays`;
    setText("exOriginalMeta", `${c.id} · ${c.source === "illustrative" ? "illustrative placeholder" : c.source === "upload" ? "your upload" : "public dataset"}`);

    const annOverlay = $("exAnnOverlayImg");
    const annEmpty = $("exAnnEmpty");
    if (c.annotationUrl) {
      annOverlay.src = c.annotationUrl;
      annOverlay.hidden = false;
      if (annEmpty) annEmpty.hidden = true;
      setText("exAnnMeta", c.source === "illustrative" ? "Illustrative outline (placeholder)" : "Expert annotation from the dataset");
    } else {
      annOverlay.hidden = true;
      if (annEmpty) {
        annEmpty.hidden = false;
        annEmpty.textContent = c.source === "upload"
          ? "No expert annotation available for this custom image upload."
          : "No dataset annotation for this case.";
      }
      setText("exAnnMeta", c.source === "upload" ? "No expert annotation (custom upload)" : "No dataset annotation for this case");
    }

    const maskOverlay = $("exModelOverlayImg");
    const maskUrl = currentMaskUrl();
    const empty = $("exModelEmpty");
    if (maskUrl) {
      maskOverlay.src = maskUrl;
      maskOverlay.hidden = false;
      empty.hidden = true;
    } else {
      maskOverlay.hidden = true;
      empty.hidden = false;
      if (!c.analysis) empty.textContent = "No model mask yet. Run the experimental model from the Workspace or Classification tab.";
      else if (!c.analysis.trained) empty.textContent = "Demo-only: no trained checkpoint answered, so no model mask is shown.";
      else empty.textContent = "The model ran but returned no segmentation mask.";
    }
  }

  $("exModelOpacitySlider").addEventListener("input", e => {
    const val = Number(e.target.value);
    setText("exModelOpacityVal", `${val}%`);
    $("exModelOverlayImg").style.opacity = val / 100;
  });

  // ---------------------------------------------------------------------
  // History / reports
  // ---------------------------------------------------------------------
  function activeHistoryFilter() {
    const active = $("historyFilterPills").querySelector(".active");
    return active ? active.getAttribute("data-filter") : "all";
  }

  function renderHistory() {
    const body = $("historyTableBody");
    if (!body) return;
    body.innerHTML = "";

    let list = state.history;
    const filter = activeHistoryFilter();
    if (filter === "model") list = list.filter(h => h.action === "model");
    if (filter === "viewed") list = list.filter(h => h.action === "viewed");

    const q = ($("historySearchInput").value || "").trim().toLowerCase();
    if (q) {
      list = list.filter(h =>
        h.id.toLowerCase().includes(q) ||
        String(h.title).toLowerCase().includes(q) ||
        String(h.caseId).toLowerCase().includes(q));
    }

    $("emptyHistoryState").hidden = list.length > 0;

    list.forEach(item => {
      const canOpen = !!findCase(item.caseId);
      const tr = document.createElement("tr");
      const refCol = item.refLabel ? esc(labelOf(item.refLabel)) : (item.source === "upload" ? "None (upload)" : "—");
      tr.innerHTML = `
        <td class="mono"><strong>${esc(item.id)}</strong></td>
        <td>${esc(item.ts)}</td>
        <td>${item.thumb
          ? `<img src="${esc(item.thumb)}" alt="Thumbnail of ${esc(item.caseId)}" style="width:32px; height:32px; border-radius:4px; object-fit:cover;">`
          : "—"}</td>
        <td>${esc(item.caseId)} &middot; ${esc(item.title)}</td>
        <td>${item.action === "model" ? "Model run" : "Case opened"}</td>
        <td class="mono">${refCol}</td>
        <td class="mono">${esc(modelOutputText(item))}</td>
        <td>
          <button class="btn btn-secondary-sm" type="button" data-report="${esc(item.id)}">Report</button>
          ${canOpen ? `<button class="btn btn-secondary-sm" type="button" data-open-case="${esc(item.caseId)}">Open</button>` : ""}
        </td>
      `;
      body.appendChild(tr);
    });
  }

  document.addEventListener("click", e => {
    const el = e.target.closest("[data-report]");
    if (!el) return;
    state.reportEntryId = el.getAttribute("data-report");
    renderReport();
    const sheet = $("reportPrintableSheet");
    if (sheet) sheet.scrollIntoView({ behavior: "smooth", block: "start" });
  });

  $("historySearchInput").addEventListener("input", renderHistory);

  $("historyFilterPills").querySelectorAll(".filter-pill").forEach(pill => {
    pill.addEventListener("click", () => {
      $("historyFilterPills").querySelectorAll(".filter-pill").forEach(p => p.classList.remove("active"));
      pill.classList.add("active");
      renderHistory();
    });
  });

  $("clearHistoryBtn").addEventListener("click", () => {
    if (confirm("Clear the local demo session history?")) {
      state.history = [];
      state.reportEntryId = null;
      state.maskCache = {};
      saveHistory();
      renderHistory();
      renderReport();
      renderOverview();
      showToast("History cleared", "info");
    }
  });

  function selectedEntry() {
    return state.history.find(h => h.id === state.reportEntryId) || state.history[0] || null;
  }

  function renderReport() {
    const entry = selectedEntry();
    const scan = $("repScanImg");
    const maskImg = $("repMaskImg");
    const maskNote = $("repMaskNote");
    const probBody = $("repProbTableBody");
    probBody.innerHTML = "";

    if (!entry) {
      setText("repDocId", "—");
      setText("repEntryId", "—");
      setText("repDate", "—");
      setText("repCaseTitle", "No entry selected");
      setText("repSource", "—");
      setText("repRefLabel", "—");
      setText("repModelMode", "MODE: —");
      setText("repPredictedClass", "—");
      setText("repConfidence", "—");
      setText("repLatency", "—");
      scan.removeAttribute("src");
      maskImg.hidden = true;
      maskNote.hidden = false;
      return;
    }

    const liveCase = findCase(entry.caseId);
    setText("repDocId", `REP-${entry.id.replace("EA-", "")}`);
    setText("repEntryId", entry.id);
    setText("repDate", entry.ts);
    setText("repCaseTitle", `${entry.caseId} · ${entry.title}`);
    setText("repSource", entry.source === "illustrative" ? "Illustrative placeholder (not a real scan)" : entry.source === "upload" ? "User upload" : "Public dataset");
    setText("repRefLabel", entry.refLabel ? `${labelOf(entry.refLabel)} — dataset reference label` : entry.source === "upload" ? "None (custom upload — no dataset reference label)" : "No dataset reference label available");

    scan.src = liveCase ? liveCase.imageUrl : (entry.thumb || "");
    scan.alt = `Scan for ${entry.caseId}`;

    const mask = state.maskCache[entry.id];
    if (mask) {
      maskImg.src = mask;
      maskImg.hidden = false;
      maskNote.hidden = true;
    } else {
      maskImg.hidden = true;
      maskNote.hidden = false;
      maskNote.textContent = entry.action === "model"
        ? (entry.trained ? "Mask not kept after reload." : "No model mask: demo-only run.")
        : "No model run for this entry.";
    }

    if (entry.action !== "model") {
      setText("repModelMode", "MODE: not run");
      setText("repPredictedClass", "—");
      setText("repConfidence", "—");
      setText("repLatency", "—");
    } else if (entry.trained && entry.prediction) {
      setText("repModelMode", `MODE: ${entry.mode} (experimental)`);
      setText("repPredictedClass", labelOf(entry.prediction));
      setText("repConfidence", `${entry.confidence.toFixed(1)}%`);
      setText("repLatency", entry.latencyMs != null ? `${entry.latencyMs} ms` : "—");
      Object.entries(entry.probabilities || {}).sort((a, b) => b[1] - a[1]).forEach(([k, v]) => {
        const meta = CLASS_META[k] || { label: cap(k), color: "#2EC4B6" };
        const tr = document.createElement("tr");
        tr.innerHTML = `
          <td><strong>${esc(meta.label)}</strong></td>
          <td class="mono">${v.toFixed(2)}%</td>
          <td>
            <div style="height:6px; background:#162231; border-radius:3px; overflow:hidden; width:120px;">
              <div style="height:100%; width:${Math.max(0, Math.min(100, v))}%; background:${meta.color};"></div>
            </div>
          </td>`;
        probBody.appendChild(tr);
      });
    } else {
      setText("repModelMode", `MODE: ${entry.mode || "unknown"} — demo-only`);
      setText("repPredictedClass", "No prediction shown");
      setText("repConfidence", "—");
      setText("repLatency", entry.latencyMs != null ? `${entry.latencyMs} ms` : "—");
    }
  }

  $("printReportBtn").addEventListener("click", () => window.print());

  $("exportJsonReportBtn").addEventListener("click", () => {
    const entry = selectedEntry();
    if (!entry) {
      showToast("No entry to export yet.", "info");
      return;
    }
    const exported = Object.assign({}, entry);
    delete exported.thumb;
    exported.disclaimer = "Educational use only. Dataset labels are reference labels; model output is experimental. Not a diagnosis.";
    exported.dataset = "BUSI (Breast Ultrasound Images Dataset), original data by Al-Dhabyani et al. (2020); mirror states CC BY 4.0";
    const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(exported, null, 2));
    const dl = document.createElement("a");
    dl.setAttribute("href", dataStr);
    dl.setAttribute("download", `${entry.id}_summary.json`);
    document.body.appendChild(dl);
    dl.click();
    dl.remove();
    showToast("Summary exported as JSON", "success");
  });

  // ---------------------------------------------------------------------
  // Sources & Ethics (live status)
  // ---------------------------------------------------------------------
  function renderSources() {
    const m = state.model;
    setText("srcApiState", m.online ? "online" : "offline");
    setText("srcMode", m.online ? m.mode : "—");
    setText("srcLoaded", m.online ? String(m.loaded) : "—");
    setText("srcClasses", m.classes.length ? m.classes.join(", ") : "—");
    setText("srcDevice", m.device);
  }

  // ---------------------------------------------------------------------
  // Educational notice modal
  // ---------------------------------------------------------------------
  function openDisclaimer() {
    const modal = $("disclaimerModal");
    modal.hidden = false;
    modal.style.display = "flex";
    $("ackDisclaimerBtn").focus();
  }

  function closeDisclaimer() {
    const modal = $("disclaimerModal");
    modal.hidden = true;
    modal.style.display = "none";
  }

  $("disclaimerModalBtn").addEventListener("click", openDisclaimer);
  $("closeDisclaimerBtn").addEventListener("click", closeDisclaimer);
  $("ackDisclaimerBtn").addEventListener("click", closeDisclaimer);
  $("disclaimerModal").addEventListener("click", e => {
    if (e.target === $("disclaimerModal")) closeDisclaimer();
  });
  document.addEventListener("keydown", e => {
    if (e.key === "Escape") closeDisclaimer();
  });

  // ---------------------------------------------------------------------
  // Init
  // ---------------------------------------------------------------------
  async function init() {
    closeDisclaimer();
    showLoading(false);
    loadHistory();
    await loadCases();
    renderSidebarCases();
    renderLibrary();
    renderOverview();
    renderMapMarkers();
    applyMapTransform();
    if (COUNTRY_FOCAL_POINTS[state.atlasLocation]) {
      zoomToCountry(state.atlasLocation);
    }
    loadAtlasCatalog();
    renderJourney();
    renderStatusDependents();
    renderHistory();
    renderReport();
    switchTab("overview", { focus: false });
    checkApiStatus();
    setInterval(checkApiStatus, 15000);
  }

  init();
})();
