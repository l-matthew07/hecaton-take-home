# Bustem Technical/Dev Take Home

## **Overview**

Your task is to build a **Next.js app** and submit a link to a **GitHub repository** containing your code. The app must be able to build and run locally.

The goal is to simulate a simplified version of Bustem’s infringement-detection pipeline.

You will build an app where a user can trigger a **search job** that finds potential fake **Comfrt** (https://comfrt.com/) listings on Amazon + eBay and returns a **ranked list** of results with a **probability score** indicating how likely each listing is to be an infringement.

We care more about **judgment, structure, and tradeoffs** than polish or perfect accuracy.

**Expected time spent:** ~2-3 hours.

---

## **Core Requirements**

### **1. Search Job**

- The app should allow a user to trigger a search job via a button.
- The job should:
    - Run for **up to 3–5 minutes**
    - Return results **progressively** (do not wait until everything finishes)
- Results should prioritize **high-confidence candidates** while attempting to avoid excessive noise.

### **2. Marketplace Data Source**

You may use this ScraperAPI key to query Amazon + eBay:

```jsx
4558fb24345f6ac0aa999ef5d14f5ea9
```

You must:

- Run **at least 5 distinct queries** (e.g. variations of “comfrt hoodie”, “comfrt sweatshirt”, etc.)
- Fetch **at least 2 pages per query**, unless you hit a time or request budget
- **Deduplicate results by ASIN / item id**

Sample request:

```jsx
curl 'https://api.scraperapi.com/structured/amazon/search/v1?api_key=4558fb24345f6ac0aa999ef5d14f5ea9&query=comfrt&tld=com'
```

### **3. Reference Set (Authentic Products)**

Create a small **reference set** of authentic Comfrt products by collecting **~8 product images** from https://comfrt.com/.

These will be used as the “ground truth” reference for similarity comparisons.

You may hardcode the URLs or scrape a single page—no need to be fancy.

---

### **4. Scoring & Similarity (Most Important Part)**

Each result must be assigned a **probability score (0–1)** representing how likely it is to be an infringement.

You must compute the score using **at least 4 independent signals**, such as:

- Image similarity
    - e.g. perceptual hashes (pHash, aHash, dHash)
- Text similarity on product title
- Fuzzy matching on brand name
- Image embeddings models
- LLMs
- OCR
- Logo detection

Although you must implement 4 signals, how much you weight each one to produce good scores is ultimately up to you. 

### **Explainability (Required)**

For each result, you must show:

- The final probability score
- The **top contributing reasons** (human-readable)
- The raw values for each signal (for inspection/debugging)

This is critical—we care about **explainable ranking**, not just a number.

---

### **5. Job Orchestration Constraints**

To keep the problem realistic:

- Implement a **concurrency limit** on external requests
- Implement a **soft request budget** (e.g. ~120 requests total)
- Gracefully degrade if certain signals fail (e.g. image fetch fails → still score using text)

You should surface **total elapsed time** and **request count** broken down by platform in the UI.

---

### **6. Frontend Expectations**

There is a lot of creative freedom on the frontend.

We are **not evaluating visual design**, but the interface should be:

- Clean and readable
- Able to display results as they arrive
- Able to sort or filter results (e.g. by score threshold or marketplace)
- Able to expand a result to see “why” it was scored that way

You will be evaluated on UX not UI

---

## **Notes & Clarifications**

- Next.js **server functions are sufficient** — no need to build a dedicated backend.
- Do **not** worry about authentication, persistence, or production-grade scalability.
- It is acceptable (and expected) that some real, authorized listings appear in results.
- Don’t stress if many results are “similar but not infringing.” Accuracy is less important than **signal design and ranking logic**.
    - That being said, if the results are good that’s a massive plus
- You may choose to run the search on as many or as few products as you want, within the time/budget constraints.

---

## **Additional Requirement**

Include a markdown file named **ARCHITECTURE.md** describing how you would evolve this into a **multi-tenant system** that can run this pipeline for **hundreds of clients**.

Please include:

- Job orchestration model (queues/workers)
- Rate limiting & per-client isolation
- What data you’d store (job state, results, artifacts)
- Retry strategy & failure handling
- Observability (metrics you’d track)

Keep this to ~1 page.

---

## **Evaluation Criteria**

We will evaluate based on:

- Pipeline design & orchestration
- Quality of scoring signals and explainability
- Code organization and clarity
- Practical tradeoffs under time/budget constraints (we need people who can think about tasks they’re given, not blindly follow tickets).
- Thoughtfulness of the backend architecture design