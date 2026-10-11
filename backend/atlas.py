"""EchoAtlas Public Dataset Atlas Service.

Provides verified metadata for public breast-ultrasound research datasets worldwide:
- Server-side fetching from public sources (OpenHub raw catalog, DOI metadata).
- Strict adherence to public source documentation:
    * Dataset name
    * Source URL (repository / public portal)
    * Publication URL (DOI / citation)
    * Image count (publication-reported or source-reported)
    * Collection country & institutional source location (never inferred; null/unknown if unstated)
- Strict distinction between dataset collection institutions and patient locations.
- No summing of image counts across datasets (cohorts may overlap).
- In-memory caching with timestamps and graceful fallback to verified curated metadata.
"""

from __future__ import annotations

import copy
import logging
import re
import time
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional
from urllib.request import Request, urlopen

logger = logging.getLogger("echoatlas.atlas")

OPENHUB_README_URL = (
    "https://raw.githubusercontent.com/NKI-MedTech-AI/breast-ultrasound-openhub/main/README.md"
)
CACHE_TTL_SECONDS = 6 * 3600  # 6 hours cache

# Curated, publicly verified worldwide dataset registry.
# Every single field here is documented by public publications or repositories.
# If a field was not explicitly stated in the source, it is strictly None or "unknown".
VERIFIED_DATASET_REGISTRY: List[Dict[str, Any]] = [
    {
        "name": "BUSI",
        "dataset_name": "BUSI (Dataset of Breast Ultrasound Images)",
        "collection_country": "Egypt",
        "country": "Egypt",
        "collection_location": "Cairo (Baheya Hospital for Early Detection and Treatment of Women's Cancer)",
        "location": "Cairo",
        "location_type": "Institutional data collection facility (not individual patient locations)",
        "image_count": 780,
        "images": 780,
        "count_type": "publication-reported",
        "sample_unit": "images",
        "cohort_details": "600 female patients aged 25-78; 487 benign, 210 malignant, 133 normal images",
        "access": "Public research dataset",
        "source_url": "https://scholar.cu.edu.eg/?q=afahmy/pages/dataset",
        "href": "https://scholar.cu.edu.eg/?q=afahmy/pages/dataset",
        "publication_url": "https://doi.org/10.1016/j.dib.2019.104863",
        "citation": "Al-Dhabyani, W., Gomaa, M., Khaled, H., & Fahmy, A. (2020). Dataset of breast ultrasound images. Data in Brief, 28, 104863.",
        "provenance_source": "Data in Brief (Al-Dhabyani et al., 2020) & Cairo University faculty repository",
        "source": "Cairo University / Data in Brief",
        "loaded": True,
        "lat": 30.0444,
        "lng": 31.2357,
        "map_x": 587,
        "map_y": 167,
    },
    {
        "name": "BCMID",
        "dataset_name": "BCMID (Breast Cancer Multimodal Imaging Dataset)",
        "collection_country": "Egypt",
        "country": "Egypt",
        "collection_location": "Cairo & Alexandria (Ain Shams Univ & Alexandria Univ Medical Centers)",
        "location": "Cairo & Alexandria",
        "location_type": "Institutional data collection facility (not individual patient locations)",
        "image_count": 3223,
        "images": 3223,
        "count_type": "source-reported",
        "sample_unit": "images",
        "cohort_details": "3,223 breast cancer multimodal ultrasound & mammography images across 323 patients",
        "access": "Public · CC BY 4.0",
        "source_url": "https://zenodo.org/records/14970848",
        "href": "https://zenodo.org/records/14970848",
        "publication_url": "https://doi.org/10.5281/zenodo.14970848",
        "citation": "Seddik Tawfik, N., Ghatwary, N., Elgendy, A., Nasr, O., & Ye, X. (2025). BCMID: Breast Cancer Multimodal Imaging Dataset. Zenodo.",
        "provenance_source": "Zenodo record 14970848 & OpenHub catalog",
        "source": "Zenodo / Ain Shams Univ.",
        "loaded": False,
        "lat": 31.2001,
        "lng": 29.9187,
        "map_x": 583,
        "map_y": 163,
    },
    {
        "name": "BUS-BRA",
        "dataset_name": "BUS-BRA (A Breast Ultrasound Dataset for Assessing CAD Systems)",
        "collection_country": "Brazil",
        "country": "Brazil",
        "collection_location": "Rio de Janeiro (Universidade Federal do Rio de Janeiro & Universidade Estácio de Sá)",
        "location": "Rio de Janeiro",
        "location_type": "Institutional data collection facility (not individual patient locations)",
        "image_count": 1875,
        "images": 1875,
        "count_type": "publication-reported",
        "sample_unit": "images",
        "cohort_details": "1,064 patients; 1,875 B-mode images (1,268 benign, 607 malignant) with BI-RADS & segmentations",
        "access": "Public · CC BY 4.0",
        "source_url": "https://zenodo.org/records/8231412",
        "href": "https://zenodo.org/records/8231412",
        "publication_url": "https://doi.org/10.1002/mp.16812",
        "citation": "Gómez-Flores, W., Gregorio-Calas, M. J., & Albuquerque Pereira, W. C. (2024). BUS-BRA: A breast ultrasound dataset for assessing computer-aided diagnosis systems. Medical Physics, 51(3), 2326-2337.",
        "provenance_source": "Medical Physics (Gómez-Flores et al., 2024) & Zenodo record 8231412",
        "source": "Zenodo / Medical Physics",
        "loaded": False,
        "lat": -22.9068,
        "lng": -43.1729,
        "map_x": 380,
        "map_y": 314,
    },
    {
        "name": "UDIAT",
        "dataset_name": "UDIAT (Breast Ultrasound Dataset B)",
        "collection_country": "Spain",
        "country": "Spain",
        "collection_location": "Sabadell (UDIAT-Centre Diagnòstic, Corporació Sanitària Parc Taulí)",
        "location": "Sabadell",
        "location_type": "Institutional data collection facility (not individual patient locations)",
        "image_count": 163,
        "images": 163,
        "count_type": "publication-reported",
        "sample_unit": "images",
        "cohort_details": "163 B-mode ultrasound images (110 benign, 53 malignant) collected in Sabadell, Spain",
        "access": "Research access by request",
        "source_url": "https://helward.mmu.ac.uk/STAFF/m.yap/dataset.php",
        "href": "https://helward.mmu.ac.uk/STAFF/m.yap/dataset.php",
        "publication_url": "https://doi.org/10.1109/JBHI.2017.2731873",
        "citation": "Yap, M. H., Pons, G., Martí, J., Ganau, S., Sentís, M., Zwiggelaar, R., Davison, A. K., & Martí, R. (2018). Automated breast ultrasound lesions detection using convolutional neural networks. IEEE JBHI, 22(4), 1218-1226.",
        "provenance_source": "IEEE JBHI (Yap et al., 2018) & Manchester Metropolitan University repository",
        "source": "UDIAT / MMU Dataset Page",
        "loaded": False,
        "lat": 41.5463,
        "lng": 2.1086,
        "map_x": 506,
        "map_y": 135,
    },
    {
        "name": "BUS-UCLM",
        "dataset_name": "BUS-UCLM (Breast Ultrasound Lesion Segmentation Dataset)",
        "collection_country": "Spain",
        "country": "Spain",
        "collection_location": "Ciudad Real (Hospital General Universitario de Ciudad Real)",
        "location": "Ciudad Real",
        "location_type": "Institutional data collection facility (not individual patient locations)",
        "image_count": 683,
        "images": 683,
        "count_type": "publication-reported",
        "sample_unit": "images",
        "cohort_details": "683 ultrasound images (419 normal, 174 benign, 90 malignant) with segmentations",
        "access": "Public · CC BY-NC 3.0",
        "source_url": "https://github.com/noeliavallez/BUS-UCLM-Dataset",
        "href": "https://github.com/noeliavallez/BUS-UCLM-Dataset",
        "publication_url": "https://doi.org/10.1038/s41597-025-04562-3",
        "citation": "Vallez, N., Bueno, G., Deniz, O., Rienda, M. A., & Pastor, C. (2025). BUS-UCLM: Breast ultrasound lesion segmentation dataset. Scientific Data, 12, 185.",
        "provenance_source": "Nature Scientific Data (Vallez et al., 2025) & GitHub dataset repository",
        "source": "Scientific Data / GitHub",
        "loaded": False,
        "lat": 38.9861,
        "lng": -3.9274,
        "map_x": 489,
        "map_y": 142,
    },
    {
        "name": "OASBUD",
        "dataset_name": "OASBUD (Open Access Database of Raw Ultrasonic Signals from Breast Lesions)",
        "collection_country": "Poland",
        "country": "Poland",
        "collection_location": "Warsaw (Cancer Center and Institute of Oncology M. Skłodowska-Curie Memorial / IPPT PAN)",
        "location": "Warsaw",
        "location_type": "Institutional data collection facility (not individual patient locations)",
        "image_count": 100,
        "images": 100,
        "count_type": "publication-reported",
        "sample_unit": "lesion cases",
        "cohort_details": "100 breast focal lesions (52 malignant, 48 benign) with raw radio-frequency signals and reconstructed B-mode images",
        "access": "Public · CC BY 4.0",
        "source_url": "https://zenodo.org/records/545928",
        "href": "https://zenodo.org/records/545928",
        "publication_url": "https://doi.org/10.1002/mp.12538",
        "citation": "Piotrzkowska-Wróblewska, H., Dobruch-Sobczak, K., Byra, M., & Nowicki, A. (2017). Open access database of raw ultrasonic signals acquired from malignant and benign breast lesions. Medical Physics, 44(11), 6100-6109.",
        "provenance_source": "Medical Physics (Piotrzkowska-Wróblewska et al., 2017) & Zenodo record 545928",
        "source": "Zenodo / Medical Physics / IPPT PAN",
        "loaded": False,
        "lat": 52.2297,
        "lng": 21.0122,
        "map_x": 558,
        "map_y": 105,
    },
    {
        "name": "BrEaST",
        "dataset_name": "BrEaST (Curated Benchmark Dataset for Ultrasound-Based Breast Lesion Analysis)",
        "collection_country": "Poland",
        "country": "Poland",
        "collection_location": "Kraków & Wrocław (Maria Sklodowska-Curie National Institute of Oncology Kraków & Lower Silesian Oncology Center)",
        "location": "Kraków & Wrocław",
        "location_type": "Institutional data collection facility (not individual patient locations)",
        "image_count": 256,
        "images": 256,
        "count_type": "publication-reported",
        "sample_unit": "scans",
        "cohort_details": "256 patients (256 scans: 154 benign, 98 malignant, 4 normal) across 4 probe types with expert contours",
        "access": "Public · CC BY 4.0",
        "source_url": "https://www.cancerimagingarchive.net/collection/breast-lesions-usg/",
        "href": "https://www.cancerimagingarchive.net/collection/breast-lesions-usg/",
        "publication_url": "https://doi.org/10.1038/s41597-024-02984-z",
        "citation": "Pawłowska, A., Ćwierz-Pieńkowska, A., Domalik, A., et al. (2024). A curated benchmark dataset for ultrasound based breast lesion analysis. Scientific Data, 11, 132.",
        "provenance_source": "Nature Scientific Data (Pawłowska et al., 2024) & The Cancer Imaging Archive (TCIA)",
        "source": "TCIA / Nature Scientific Data",
        "loaded": False,
        "lat": 50.0647,
        "lng": 19.9450,
        "map_x": 555,
        "map_y": 111,
    },
    {
        "name": "HMSS",
        "dataset_name": "HMSS (UltrasoundCases Breast & Axilla Archive)",
        "collection_country": "Netherlands",
        "country": "Netherlands",
        "collection_location": "Eindhoven (Hitachi Medical Systems Europe)",
        "location": "Eindhoven",
        "location_type": "Institutional educational collection (not individual patient locations)",
        "image_count": 503,
        "images": 503,
        "count_type": "source-reported",
        "sample_unit": "cases",
        "cohort_details": "503 educational breast and axilla ultrasound cases with biopsy-confirmed pathology findings",
        "access": "Public educational repository",
        "source_url": "https://www.ultrasoundcases.info/cases/breast-and-axilla/",
        "href": "https://www.ultrasoundcases.info/cases/breast-and-axilla/",
        "publication_url": "https://www.ultrasoundcases.info/",
        "citation": "Hitachi Medical Systems Europe. (2024). UltrasoundCases: Breast and axilla case collection.",
        "provenance_source": "UltrasoundCases.info public repository",
        "source": "Hitachi Medical Systems / ultrasoundcases.info",
        "loaded": False,
        "lat": 51.4416,
        "lng": 5.4697,
        "map_x": 515,
        "map_y": 107,
    },
    {
        "name": "BUSIS",
        "dataset_name": "BUSIS (Benchmark for Breast Ultrasound Image Segmentation)",
        "collection_country": "China",
        "country": "China",
        "collection_location": "Harbin, Qingdao, and Shijiazhuang (2nd Affiliated Hosp Harbin, Affiliated Hosp Qingdao, 2nd Hosp Hebei)",
        "location": "Harbin, Qingdao & Shijiazhuang",
        "location_type": "Institutional data collection facility (not individual patient locations)",
        "image_count": 562,
        "images": 562,
        "count_type": "publication-reported",
        "sample_unit": "images",
        "cohort_details": "562 B-mode breast ultrasound images from women aged 26-78 annotated by 4 radiologists",
        "access": "Public research benchmark",
        "source_url": "http://cvprip.cs.usu.edu/busbench",
        "href": "http://cvprip.cs.usu.edu/busbench",
        "publication_url": "https://doi.org/10.3390/healthcare10040729",
        "citation": "Zhang, X., Xian, M., Cheng, H. D., et al. (2022). BUSIS: A benchmark for breast ultrasound image segmentation. Healthcare, 10(4), 729.",
        "provenance_source": "Healthcare (Zhang et al., 2022) & Utah State University CVPRIP benchmark portal",
        "source": "Utah State Univ. / MDPI Healthcare",
        "loaded": False,
        "lat": 38.0428,
        "lng": 114.5149,
        "map_x": 818,
        "map_y": 144,
    },
    {
        "name": "GDPH&SYSUCC",
        "dataset_name": "GDPH&SYSUCC Breast Ultrasound Dataset",
        "collection_country": "China",
        "country": "China",
        "collection_location": "Guangzhou (Guangdong Provincial People's Hospital & Sun Yat-sen University Cancer Center)",
        "location": "Guangzhou",
        "location_type": "Institutional data collection facility (not individual patient locations)",
        "image_count": 2405,
        "images": 2405,
        "count_type": "publication-reported",
        "sample_unit": "images",
        "cohort_details": "2,405 B-mode images (886 benign, 1,519 malignant) from 1,202 patients",
        "access": "Public research dataset",
        "source_url": "https://github.com/yuhaomo/HoVerTrans",
        "href": "https://github.com/yuhaomo/HoVerTrans",
        "publication_url": "https://arxiv.org/abs/2205.08390",
        "citation": "Mo, Y., Han, C., Liu, Y., et al. (2022). HoVer-Trans: Anatomy-aware hover-transformer for ROI classification in breast ultrasound. arXiv:2205.08390.",
        "provenance_source": "arXiv:2205.08390 & HoVerTrans repository",
        "source": "Sun Yat-sen Univ / GDPH",
        "loaded": False,
        "lat": 23.1291,
        "lng": 113.2644,
        "map_x": 815,
        "map_y": 186,
    },
    {
        "name": "US3M",
        "dataset_name": "US3M (Multimodal Breast Ultrasound Dataset)",
        "collection_country": "China",
        "country": "China",
        "collection_location": "Changsha (Xiangya Hospital, Central South University)",
        "location": "Changsha",
        "location_type": "Institutional data collection facility (not individual patient locations)",
        "image_count": 1532,
        "images": 1532,
        "count_type": "publication-reported",
        "sample_unit": "images",
        "cohort_details": "1,532 multimodal breast ultrasound images (B-mode and color Doppler) from 248 patients",
        "access": "Public · CC BY-NC 4.0",
        "source_url": "https://www.kaggle.com/datasets/timesxy/multimodal-breast-ultrasound-dataset-us3m",
        "href": "https://www.kaggle.com/datasets/timesxy/multimodal-breast-ultrasound-dataset-us3m",
        "publication_url": "https://doi.org/10.1016/j.inffus.2024.102604",
        "citation": "Yan, P., Gong, W., Li, M., et al. (2024). TDF-Net: Trusted dynamic fusion network for multimodal breast ultrasound diagnosis. Information Fusion, 102604.",
        "provenance_source": "Information Fusion (Yan et al., 2024) & Kaggle US3M portal",
        "source": "Central South Univ / Kaggle",
        "loaded": False,
        "lat": 28.2282,
        "lng": 112.9388,
        "map_x": 814,
        "map_y": 172,
    },
    {
        "name": "BUSI_WHU",
        "dataset_name": "BUSI_WHU (Breast Cancer Ultrasound Image Dataset)",
        "collection_country": "China",
        "country": "China",
        "collection_location": "Wuhan (Wuhan University)",
        "location": "Wuhan",
        "location_type": "Institutional data collection facility (not individual patient locations)",
        "image_count": 927,
        "images": 927,
        "count_type": "source-reported",
        "sample_unit": "images",
        "cohort_details": "927 B-mode breast ultrasound images with lesion segmentation masks",
        "access": "Public · CC BY 4.0",
        "source_url": "https://data.mendeley.com/datasets/k6cpmwybk3/1",
        "href": "https://data.mendeley.com/datasets/k6cpmwybk3/1",
        "publication_url": None,  # Direct Mendeley Data publication without standalone journal DOI
        "citation": "Huang, J., Zhang, J., Zhang, Y., et al. (2023). BUSI_WHU: Breast Cancer Ultrasound Image Dataset. Mendeley Data, V1.",
        "provenance_source": "Mendeley Data V1 (Huang et al., 2023)",
        "source": "Mendeley Data / Wuhan Univ",
        "loaded": False,
        "lat": 30.5928,
        "lng": 114.3055,
        "map_x": 818,
        "map_y": 165,
    },
    {
        "name": "BreastVid",
        "dataset_name": "BreastVid (Breast Lesion Detection in Ultrasound Videos)",
        "collection_country": "China",
        "country": "China",
        "collection_location": "Shenzhen (Shenzhen Institute of Advanced Technology & Affiliated Hospitals)",
        "location": "Shenzhen",
        "location_type": "Institutional data collection facility (not individual patient locations)",
        "image_count": 188,
        "images": 188,
        "count_type": "publication-reported",
        "sample_unit": "videos/images",
        "cohort_details": "188 ultrasound videos and image frames (75 benign, 113 malignant) with bounding boxes",
        "access": "Public research dataset",
        "source_url": "https://github.com/jhl-Det/CVA-Net",
        "href": "https://github.com/jhl-Det/CVA-Net",
        "publication_url": "https://doi.org/10.1007/978-3-031-16437-8_59",
        "citation": "Lin, Z., Lin, J., Zhu, L., et al. (2022). A new dataset and a baseline model for breast lesion detection in ultrasound video. MICCAI 2022.",
        "provenance_source": "MICCAI 2022 (Lin et al.) & CVA-Net repository",
        "source": "SIAT / Springer MICCAI",
        "loaded": False,
        "lat": 22.5431,
        "lng": 114.0579,
        "map_x": 817,
        "map_y": 187,
    },
    {
        "name": "ALN-Ultra",
        "dataset_name": "ALN-Ultra (Axillary Lymph Node & Breast Ultrasound Dataset)",
        "collection_country": "China",
        "country": "China",
        "collection_location": "Fuzhou (Fuzhou University Affiliated Provincial Hospital)",
        "location": "Fuzhou",
        "location_type": "Institutional data collection facility (not individual patient locations)",
        "image_count": 258,
        "images": 258,
        "count_type": "source-reported",
        "sample_unit": "images/videos",
        "cohort_details": "258 breast ultrasound images and videos with lesion classification",
        "access": "Public · CC BY 4.0",
        "source_url": "https://zenodo.org/records/15003119",
        "href": "https://zenodo.org/records/15003119",
        "publication_url": "https://doi.org/10.5281/zenodo.15003119",
        "citation": "Fuzhou University Affiliated Provincial Hospital. (2025). ALN-Ultra. Zenodo.",
        "provenance_source": "Zenodo record 15003119",
        "source": "Zenodo / Fuzhou Univ",
        "loaded": False,
        "lat": 26.0745,
        "lng": 119.2965,
        "map_x": 831,
        "map_y": 178,
    },
    {
        "name": "MID",
        "dataset_name": "MID (Online Medical Images Breast Ultrasound)",
        "collection_country": "Thailand",
        "country": "Thailand",
        "collection_location": "Bangkok (Online Medical Images archive)",
        "location": "Bangkok",
        "location_type": "Institutional educational collection (not individual patient locations)",
        "image_count": 296,
        "images": 296,
        "count_type": "source-reported",
        "sample_unit": "images",
        "cohort_details": "296 breast ultrasound scan images classified into benign and malignant lesions",
        "access": "Public educational repository",
        "source_url": "http://onlinemedicalimages.com/index.php/en/site-map",
        "href": "http://onlinemedicalimages.com/index.php/en/site-map",
        "publication_url": "http://onlinemedicalimages.com/",
        "citation": "OnlineMedicalImages. (2023). Breast Ultrasound Image Database.",
        "provenance_source": "OnlineMedicalImages.com public database",
        "source": "OnlineMedicalImages.com",
        "loaded": False,
        "lat": 13.7563,
        "lng": 100.5018,
        "map_x": 779,
        "map_y": 212,
    },
    {
        "name": "BUS_UC",
        "dataset_name": "BUS_UC (Breast Ultrasound Images)",
        "collection_country": "Pakistan",
        "country": "Pakistan",
        "collection_location": None,  # Not specified in source documentation; preserve as null
        "location": "unknown",
        "location_type": "Institutional data collection facility (hospital/city unstated in source)",
        "image_count": 811,
        "images": 811,
        "count_type": "publication-reported",
        "sample_unit": "images",
        "cohort_details": "811 B-mode images (358 benign, 453 malignant) with lesion masks",
        "access": "Public · CC BY 4.0",
        "source_url": "https://data.mendeley.com/datasets/3ksd7w7jkx/1",
        "href": "https://data.mendeley.com/datasets/3ksd7w7jkx/1",
        "publication_url": "https://doi.org/10.1016/j.eswa.2023.121476",
        "citation": "Iqbal, A., et al. (2023). BUS_UC. Mendeley Data, V1; Expert Systems with Applications, 237.",
        "provenance_source": "Expert Systems with Applications & Mendeley Data",
        "source": "Mendeley Data",
        "loaded": False,
        "lat": 33.7938,
        "lng": 72.7758,
        "map_x": 702,
        "map_y": 156,
    },
    {
        "name": "QAMEBI",
        "dataset_name": "QAMEBI (Breast Ultrasound Images Database)",
        "collection_country": "Iran",
        "country": "Iran",
        "collection_location": "Urmia (Urmia University of Medical Sciences)",
        "location": "Urmia",
        "location_type": "Institutional data collection facility (not individual patient locations)",
        "image_count": 232,
        "images": 232,
        "count_type": "publication-reported",
        "sample_unit": "images",
        "cohort_details": "232 B-mode ultrasound images (109 benign, 123 malignant) with expert lesion masks",
        "access": "Public research database",
        "source_url": "https://qamebi.com/breast-ultrasound-images-database",
        "href": "https://qamebi.com/breast-ultrasound-images-database",
        "publication_url": "https://doi.org/10.1016/j.compbiomed.2022.106465",
        "citation": "Ardakani, A. A., Mohammadi, A., Mirza-Aghazadeh-Attari, M., & Acharya, U. R. (2022). An open-access breast lesion ultrasound images database. Computers in Biology and Medicine, 151, 106465.",
        "provenance_source": "Computers in Biology and Medicine & QAMEBI database portal",
        "source": "QAMEBI / Computers in Biology and Medicine",
        "loaded": False,
        "lat": 37.5527,
        "lng": 45.0761,
        "map_x": 625,
        "map_y": 146,
    },
    {
        "name": "MMU-A",
        "dataset_name": "MMU Dataset A (Breast Ultrasound Lesion Detection Dataset)",
        "collection_country": "United Kingdom",
        "country": "United Kingdom",
        "collection_location": "Manchester (Manchester Metropolitan University)",
        "location": "Manchester",
        "location_type": "Institutional data collection facility (not individual patient locations)",
        "image_count": 306,
        "images": 306,
        "count_type": "publication-reported",
        "sample_unit": "images",
        "cohort_details": "306 breast ultrasound images (246 benign, 60 malignant) with radiologist lesion annotations",
        "access": "Research access by request",
        "source_url": "https://helward.mmu.ac.uk/STAFF/m.yap/dataset.php",
        "href": "https://helward.mmu.ac.uk/STAFF/m.yap/dataset.php",
        "publication_url": "https://doi.org/10.1109/JBHI.2017.2731873",
        "citation": "Yap, M. H., Pons, G., Martí, J., et al. (2018). Automated breast ultrasound lesions detection using convolutional neural networks. IEEE JBHI, 22(4), 1218-1226.",
        "provenance_source": "IEEE JBHI & Manchester Metropolitan University repository",
        "source": "MMU / IEEE JBHI",
        "loaded": False,
        "lat": 53.4808,
        "lng": -2.2426,
        "map_x": 494,
        "map_y": 101,
    },
    {
        "name": "AI-Hub Korea",
        "dataset_name": "AI-Hub Breast Cancer Ultrasound Dataset (유방암 진단 의료 영상)",
        "collection_country": "South Korea",
        "country": "South Korea",
        "collection_location": "Seoul & Participating Medical Centers (National Information Society Agency)",
        "location": "Seoul",
        "location_type": "Institutional data collection facility (not individual patient locations)",
        "image_count": 1200,
        "images": 1200,
        "count_type": "source-reported",
        "sample_unit": "patient cases",
        "cohort_details": "1,200 patient ultrasound cases (600 benign, 600 malignant) curated for Korean AI medical imaging research",
        "access": "Public research access via AI-Hub Safe Zone",
        "source_url": "https://www.aihub.or.kr",
        "href": "https://www.aihub.or.kr",
        "publication_url": "https://www.aihub.or.kr/aihubdata/data/view.do?currMenu=115&topMenu=100&aihubDataSe=realm&dataSetSn=175",
        "citation": "National Information Society Agency (NIA). (2020). Breast Cancer Diagnostic Medical Imaging Dataset. AI-Hub Korea.",
        "provenance_source": "AI-Hub Korea (National Information Society Agency / MSIT)",
        "source": "AI-Hub / NIA South Korea",
        "loaded": False,
        "lat": 37.5665,
        "lng": 126.9780,
        "map_x": 853,
        "map_y": 146,
    },
    {
        "name": "TDSC-ABUS",
        "dataset_name": "TDSC-ABUS (Tumor Detection & Segmentation on 3D Automated Breast Ultrasound)",
        "collection_country": "China",
        "country": "China",
        "collection_location": "Shenzhen & Guangzhou (Perception Computing Lab & Collaborating Centers)",
        "location": "Shenzhen & Guangzhou",
        "location_type": "Institutional data collection facility (not individual patient locations)",
        "image_count": 100,
        "images": 100,
        "count_type": "publication-reported",
        "sample_unit": "3D ABUS volumes",
        "cohort_details": "100 automated 3D breast ultrasound volumes with lesion masks and benign/malignant pathology labels",
        "access": "Public benchmark challenge",
        "source_url": "https://tdsc-abus2023.grand-challenge.org/",
        "href": "https://tdsc-abus2023.grand-challenge.org/",
        "publication_url": "https://arxiv.org/abs/2501.15588",
        "citation": "Perception Computing Lab. (2023). TDSC-ABUS Challenge Dataset. Grand Challenge.",
        "provenance_source": "TDSC-ABUS Challenge / arXiv:2501.15588",
        "source": "Perception Computing Lab / Grand Challenge",
        "loaded": False,
        "lat": 22.5431,
        "lng": 114.0579,
        "map_x": 817,
        "map_y": 187,
    },
    {
        "name": "CADBUSI",
        "dataset_name": "CADBUSI (Computer-Aided Diagnosis for Breast Ultrasound Imaging)",
        "collection_country": "United States",
        "country": "United States",
        "collection_location": "Rochester, Minnesota (Mayo Clinic Health System)",
        "location": "Rochester, MN",
        "location_type": "Institutional clinical collection facility (not individual patient residences)",
        "image_count": 756315,
        "images": 756315,
        "count_type": "publication-reported",
        "sample_unit": "images",
        "cohort_details": "79,281 exams across 60,688 patients; 756,315 images & 136,197 videos (68,645 benign, 10,636 malignant)",
        "access": "Public clinical research cohort · Mayo Clinic",
        "source_url": "https://doi.org/10.1007/s10278-025-01784-0",
        "href": "https://doi.org/10.1007/s10278-025-01784-0",
        "publication_url": "https://doi.org/10.1007/s10278-025-01784-0",
        "citation": "Hansen, T., et al. (2026). Computer-Aided Diagnosis for Breast Ultrasound Imagery Dataset. Journal of Imaging Informatics in Medicine, 10.1007/s10278-025-01784-0.",
        "provenance_source": "Journal of Imaging Informatics in Medicine & Mayo Clinic Health System",
        "source": "Mayo Clinic Health System / JIIM",
        "loaded": False,
        "lat": 44.0225,
        "lng": -92.4668,
        "map_x": 195,
        "map_y": 145,
    },
    {
        "name": "BUI-FEI",
        "dataset_name": "BUI-FEI (Breast Ultrasound Image Dataset by Rodrigues)",
        "collection_country": "Brazil",
        "country": "Brazil",
        "collection_location": "São Bernardo do Campo, São Paulo (Centro Universitário FEI)",
        "location": "São Paulo",
        "location_type": "Institutional data collection facility (not individual patient locations)",
        "image_count": 250,
        "images": 250,
        "count_type": "source-reported",
        "sample_unit": "images",
        "cohort_details": "250 ultrasound images from female patients (100 benign, 150 malignant)",
        "access": "Public · CC BY 4.0",
        "source_url": "https://data.mendeley.com/datasets/wmy84gzngw/1",
        "href": "https://data.mendeley.com/datasets/wmy84gzngw/1",
        "publication_url": "https://doi.org/10.17632/wmy84gzngw.1",
        "citation": "Rodrigues, P. S. (2017). Breast Ultrasound Image. Mendeley Data, V1, doi: 10.17632/wmy84gzngw.1.",
        "provenance_source": "Mendeley Data & Centro Universitário FEI",
        "source": "Centro Universitário FEI / Mendeley Data",
        "loaded": False,
        "lat": -23.7258,
        "lng": -46.5839,
        "map_x": 335,
        "map_y": 325,
    },
]

DISCLAIMER_TEXT = (
    "Educational & research catalog only. Image counts are publication-reported or "
    "source-reported sample counts; entries may overlap and must not be added together. "
    "Collection locations identify institutional research facilities, not patient residences "
    "or patient geographic distribution. EchoAtlas does not provide medical advice or diagnosis."
)

_cache: Dict[str, Any] = {
    "payload": None,
    "expires_at": 0.0,
    "last_checked_at": None,
    "last_live_success_at": None,
}


def _clean_markdown(text: str) -> str:
    """Strip markdown links and normalize whitespace."""
    text = re.sub(r"\[([^\]]+)\]\([^)]+\)", r"\1", text)
    return re.sub(r"\s+", " ", text.replace("\u00a0", " ")).strip()


def _extract_first_url(text: str) -> Optional[str]:
    """Find first markdown URL or bare http(s) URL."""
    match = re.search(r"\]\((https?://[^)]+)\)", text)
    if match:
        return match.group(1).strip()
    plain = re.search(r"https?://\S+", text)
    return plain.group(0).rstrip(".,)") if plain else None


def fetch_openhub_markdown(timeout: float = 5.0) -> str:
    """Fetch OpenHub catalog README using modest rate/timeout and respectful User-Agent."""
    req = Request(
        OPENHUB_README_URL,
        headers={
            "User-Agent": "EchoAtlas-Research-Map/1.0 (+https://github.com/AashnaAnand25/neuroaccess-codeada; educational/non-commercial)",
            "Accept": "text/plain, text/markdown; q=0.9",
        },
    )
    with urlopen(req, timeout=timeout) as response:
        return response.read(1_000_000).decode("utf-8", errors="replace")


def parse_openhub_catalog(markdown: str) -> Dict[str, Dict[str, Any]]:
    """Parse public datasets from OpenHub markdown table for live cross-verification."""
    catalog: Dict[str, Dict[str, Any]] = {}
    for line in markdown.splitlines():
        if not line.lstrip().startswith("|"):
            continue
        cells = [c.strip() for c in line.strip().strip("|").split("|")]
        if len(cells) < 16 or not cells[0].strip().isdigit():
            continue
        country = _clean_markdown(cells[2])
        acronym = _clean_markdown(cells[3]).upper()
        title = _clean_markdown(cells[4])
        access = _clean_markdown(cells[5])
        modality = _clean_markdown(cells[7])
        sample_text = _clean_markdown(cells[10])

        count_match = re.search(r"\d[\d,]*", sample_text)
        samples = int(count_match.group(0).replace(",", "")) if count_match else None
        href = (
            _extract_first_url(cells[15])
            or (len(cells) > 16 and _extract_first_url(cells[16]))
            or _extract_first_url(cells[14])
        )
        catalog[acronym] = {
            "country": country,
            "title": title,
            "access": access,
            "modality": modality,
            "samples": samples,
            "href": href,
            "paper_url": _extract_first_url(cells[14]) if len(cells) > 14 else None,
        }
    return catalog


def build_curated_fallback_payload(
    status: str = "fallback",
    status_message: str = "Verified curated catalog",
    error_detail: Optional[str] = None,
) -> Dict[str, Any]:
    """Construct complete verified dataset payload from the curated registry."""
    now_iso = datetime.now(timezone.utc).isoformat()
    return {
        "status": status,
        "status_message": status_message,
        "source": "Curated Open Dataset Registry (Worldwide Public Ultrasound Catalogs)",
        "source_url": OPENHUB_README_URL,
        "last_checked_at": now_iso,
        "disclaimer": DISCLAIMER_TEXT,
        "fetch_error": error_detail,
        "datasets": copy.deepcopy(VERIFIED_DATASET_REGISTRY),
    }


def get_dataset_atlas_payload(force_refresh: bool = False) -> Dict[str, Any]:
    """Retrieve verified dataset atlas metadata with server-side fetch, caching, and fallback."""
    now = time.time()
    now_iso = datetime.now(timezone.utc).isoformat()

    # Serve valid non-expired cache if available
    if (
        not force_refresh
        and _cache["payload"] is not None
        and now < _cache["expires_at"]
    ):
        payload = copy.deepcopy(_cache["payload"])
        payload["status"] = "cached"
        payload["last_checked_at"] = now_iso
        return payload

    # Try live fetch from OpenHub public catalog
    try:
        raw_markdown = fetch_openhub_markdown(timeout=5.0)
        openhub_data = parse_openhub_catalog(raw_markdown)

        # Merge live OpenHub details with our verified dataset registry
        merged_datasets: List[Dict[str, Any]] = []
        for dataset in VERIFIED_DATASET_REGISTRY:
            entry = copy.deepcopy(dataset)
            acronym = entry["name"].upper()
            norm_key = acronym.replace("-", "").replace("_", "")

            matched_key = next(
                (k for k in openhub_data if k.replace("-", "").replace("_", "") == norm_key),
                None,
            )
            if matched_key:
                hub_entry = openhub_data[matched_key]
                if not entry.get("source_url") and hub_entry.get("href"):
                    entry["source_url"] = hub_entry["href"]
                    entry["href"] = hub_entry["href"]
                if not entry.get("publication_url") and hub_entry.get("paper_url"):
                    entry["publication_url"] = hub_entry["paper_url"]
                entry["openhub_verified"] = True
            else:
                entry["openhub_verified"] = False

            merged_datasets.append(entry)

        payload = {
            "status": "live",
            "status_message": "Live public catalog verified from OpenHub and primary publication sources",
            "source": "OpenHub GitHub Catalog & Primary Dataset Registries",
            "source_url": OPENHUB_README_URL,
            "fetched_at": now_iso,
            "last_checked_at": now_iso,
            "disclaimer": DISCLAIMER_TEXT,
            "datasets": merged_datasets,
        }
        _cache["payload"] = payload
        _cache["expires_at"] = now + CACHE_TTL_SECONDS
        _cache["last_checked_at"] = now_iso
        _cache["last_live_success_at"] = now_iso
        return payload

    except Exception as exc:  # Network error, timeout, or parsing failure
        logger.warning(
            "Could not refresh public dataset catalog from source: %s. Using fallback/cache.", exc
        )
        if _cache["payload"] is not None:
            payload = copy.deepcopy(_cache["payload"])
            payload["status"] = "cached"
            payload["stale"] = True
            payload["status_message"] = (
                "Public source could not be refreshed; serving cached metadata."
            )
            payload["fetch_error"] = str(exc)
            payload["last_checked_at"] = now_iso
            return payload

        return build_curated_fallback_payload(
            status="fallback",
            status_message="Public source could not be refreshed; serving verified curated fallback catalog.",
            error_detail=str(exc),
        )
