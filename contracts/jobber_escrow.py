# { "Depends": "py-genlayer:1jb45aa8ynh2a9c9xn3b7qqh8sm5q93hwfp7jqmwsfhh8jpz09h6" }

from genlayer import *
import json
import typing
from datetime import datetime, timezone


class JobberEscrow(gl.Contract):
    """
    JobberEscrow is an Intelligent Contract for decentralized freelance agreements.
    It manages secure escrow custody, state transitions, and reputation ratings.
    """
    job_count: i32
    jobs: TreeMap[str, str]  # job_id -> JSON-encoded Job data
    ratings: TreeMap[str, str]  # address -> JSON-encoded Rating data {total_score, count, average}

    def __init__(self):
        self.job_count = i32(0)

    @gl.public.write.payable
    def create_job(self, title: str, description: str, requirements: str, duration_hours: i32) -> i32:
        """
        Creates a new freelance job agreement and locks the escrow deposit.
        """
        deposit = gl.message.value
        if deposit == u256(0):
            raise gl.vm.UserError("Escrow deposit amount must be greater than zero")
        if int(duration_hours) < 1:
            raise gl.vm.UserError("Job duration must be at least 1 hour")

        self.job_count = i32(int(self.job_count) + 1)
        job_id = str(int(self.job_count))
        current_time = int(datetime.now(timezone.utc).timestamp())

        # Status states:
        # 0 = Open (Waiting for contractor)
        # 1 = In Progress (Contractor working)
        # 2 = Work Submitted (Pending review)
        # 3 = Disputed (AI arbitration active)
        # 4 = Completed (Funds disbursed)
        # 5 = Cancelled/Refunded (Agreement terminated)
        job_data = {
            "id": job_id,
            "employer": str(gl.message.sender_address),
            "contractor": "",
            "title": title,
            "description": description,
            "requirements": requirements,
            "escrow_amount": str(deposit),
            "status": 0,
            "deliverable": "",
            "dispute_reason": "",
            "resolution": "",
            "created_at": current_time,
            "deadline": current_time + (int(duration_hours) * 3600),
            "employer_rated": False,
            "contractor_rated": False
        }

        self.jobs[job_id] = json.dumps(job_data)
        return self.job_count

    @gl.public.write
    def accept_job(self, job_id: str) -> None:
        """
        Allows a freelancer to accept an open job and commit to the timeline.
        """
        job = json.loads(self.jobs[job_id])
        if job["status"] != 0:
            raise gl.vm.UserError("Job is not open for applications")
        if str(gl.message.sender_address) == job["employer"]:
            raise gl.vm.UserError("Employer cannot accept their own job")

        job["contractor"] = str(gl.message.sender_address)
        job["status"] = 1
        self.jobs[job_id] = json.dumps(job)

    @gl.public.write
    def submit_work(self, job_id: str, deliverable: str) -> None:
        """
        Allows the contractor to submit the completed work description or link before the deadline.
        """
        job = json.loads(self.jobs[job_id])
        if job["status"] != 1:
            raise gl.vm.UserError("Job is not in progress")
        if str(gl.message.sender_address) != job["contractor"]:
            raise gl.vm.UserError("Only the assigned contractor can submit work")
        
        current_time = int(datetime.now(timezone.utc).timestamp())
        if current_time > job["deadline"]:
            raise gl.vm.UserError("Job deadline has passed. Contact the employer.")

        job["deliverable"] = deliverable
        job["status"] = 2
        self.jobs[job_id] = json.dumps(job)

    @gl.public.write
    def approve_work(self, job_id: str) -> None:
        """
        Allows the employer to approve the submitted work and release the full escrow to the contractor.
        """
        job = json.loads(self.jobs[job_id])
        if job["status"] != 2:
            raise gl.vm.UserError("No work has been submitted for approval")
        if str(gl.message.sender_address) != job["employer"]:
            raise gl.vm.UserError("Only the employer can approve work and release funds")

        job["status"] = 4
        self.jobs[job_id] = json.dumps(job)
        
        # Disburse funds to contractor
        self._disburse_payment(job["contractor"], u256(int(job["escrow_amount"])))

    @gl.public.write
    def raise_dispute(self, job_id: str, reason: str) -> None:
        """
        Allows the employer to reject the work submission and raise an official dispute.
        """
        job = json.loads(self.jobs[job_id])
        if job["status"] != 2:
            raise gl.vm.UserError("Disputes can only be raised after work has been submitted")
        if str(gl.message.sender_address) != job["employer"]:
            raise gl.vm.UserError("Only the employer can raise a dispute")

        job["status"] = 3
        job["dispute_reason"] = reason
        self.jobs[job_id] = json.dumps(job)

    @gl.public.write
    def cancel_job(self, job_id: str) -> None:
        """
        Allows the employer to cancel an open job and withdraw the escrow.
        """
        job = json.loads(self.jobs[job_id])
        if str(gl.message.sender_address) != job["employer"]:
            raise gl.vm.UserError("Only the employer can cancel this job")
        if job["status"] != 0:
            raise gl.vm.UserError("Can only cancel jobs that are still open")

        job["status"] = 5
        self.jobs[job_id] = json.dumps(job)
        self._disburse_payment(job["employer"], u256(int(job["escrow_amount"])))

    @gl.public.write
    def claim_expired_refund(self, job_id: str) -> None:
        """
        Allows the employer to reclaim the escrow if the contractor fails to deliver work before the deadline.
        """
        job = json.loads(self.jobs[job_id])
        if job["status"] != 1:
            raise gl.vm.UserError("Can only claim refunds on active jobs that have not been submitted")
        
        current_time = int(datetime.now(timezone.utc).timestamp())
        if current_time <= job["deadline"]:
            raise gl.vm.UserError("The contract deadline has not expired yet")

        job["status"] = 5
        self.jobs[job_id] = json.dumps(job)
        self._disburse_payment(job["employer"], u256(int(job["escrow_amount"])))

    @gl.public.view
    def get_job(self, job_id: str) -> str:
        """
        Returns JSON representation of a job.
        """
        return self.jobs[job_id]

    @gl.public.view
    def get_job_count(self) -> i32:
        """
        Returns the total count of jobs created.
        """
        return self.job_count

    @gl.public.write
    def resolve_dispute(self, job_id: str) -> typing.Any:
        """
        Triggers GenLayer AI arbitration to resolve a contract dispute.
        Validators execute the same analysis and reach consensus.
        """
        job = json.loads(self.jobs[job_id])
        if job["status"] != 3:
            raise gl.vm.UserError("Job is not in disputed state")

        def leader_fn():
            prompt = f"""You are an AI arbitrator for a freelance job dispute on Jobber.

JOB TITLE: {job['title']}
JOB DESCRIPTION: {job['description']}
CONTRACT REQUIREMENTS: {job['requirements']}
DELIVERABLE SUBMITTED BY CONTRACTOR: {job['deliverable']}
EMPLOYER'S DISPUTE REASON: {job['dispute_reason']}

Evaluate whether the contractor meets the job requirements.
Consider:
1. Does the deliverable fulfill the core technical requirements?
2. Is the employer's dispute reason valid and fair?
3. What is a fair payout distribution?

You must output a raw JSON object containing EXACTLY:
{{
    "decision": "contractor" or "employer" or "split",
    "reasoning": "A brief explanation of your decision",
    "payout_percent": 0 to 100
}}
Ensure there is no extra text or markdown surrounding the JSON. Output only the JSON.
"""
            response = gl.nondet.exec_prompt(prompt)
            return self._parse_json(response)

        def validator_fn(leader_result) -> bool:
            if not isinstance(leader_result, gl.vm.Return):
                return False
            validator_data = leader_fn()
            leader_data = leader_result.calldata
            
            # Decision must match exactly
            if leader_data["decision"] != validator_data["decision"]:
                return False
            
            # Payout percentage must match within a 10% tolerance
            return abs(leader_data["payout_percent"] - validator_data["payout_percent"]) <= 10

        result = gl.vm.run_nondet_unsafe(leader_fn, validator_fn)

        escrow_amount = u256(int(job["escrow_amount"]))
        payout_pct = result["payout_percent"]
        contractor_share = u256((int(escrow_amount) * payout_pct) // 100)
        employer_share = u256(int(escrow_amount) - int(contractor_share))

        if int(contractor_share) > 0:
            self._disburse_payment(job["contractor"], contractor_share)
        if int(employer_share) > 0:
            self._disburse_payment(job["employer"], employer_share)

        job["status"] = 4
        job["resolution"] = json.dumps(result)
        self.jobs[job_id] = json.dumps(job)
        return result

    def _parse_json(self, raw_str: str) -> typing.Any:
        """
        Safely extracts and parses JSON content from LLM output, resilient to markdown ticks and text wrapper blocks.
        """
        start = raw_str.find("{")
        end = raw_str.rfind("}")
        if start == -1 or end == -1 or start > end:
            raise gl.vm.UserError("Arbitrator output did not contain valid JSON block")
        json_str = raw_str[start : end + 1]
        try:
            data = json.loads(json_str)
        except Exception:
            raise gl.vm.UserError("Failed to parse JSON content from arbitrator")
        
        # Verify schema
        if "decision" not in data or "payout_percent" not in data:
            raise gl.vm.UserError("Arbitrator JSON output is missing required fields")
        
        # Validate values
        decision = str(data["decision"]).lower()
        if decision not in ["contractor", "employer", "split"]:
            raise gl.vm.UserError("Invalid decision option returned by arbitrator")
            
        try:
            percent = int(data["payout_percent"])
        except Exception:
            raise gl.vm.UserError("Payout percent must be an integer")
            
        if percent < 0 or percent > 100:
            raise gl.vm.UserError("Payout percent must be between 0 and 100")
            
        data["decision"] = decision
        data["payout_percent"] = percent
        return data

    @gl.public.write
    def rate_employer(self, job_id: str, score: i32) -> None:
        """
        Allows the contractor to rate the employer after job completion (1-5 stars).
        """
        if int(score) < 1 or int(score) > 5:
            raise gl.vm.UserError("Rating score must be between 1 and 5")
        
        job = json.loads(self.jobs[job_id])
        if job["status"] != 4:
            raise gl.vm.UserError("Ratings can only be submitted for completed jobs")
        if str(gl.message.sender_address) != job["contractor"]:
            raise gl.vm.UserError("Only the assigned contractor can rate the employer")
        if job["employer_rated"]:
            raise gl.vm.UserError("You have already rated the employer for this job")

        job["employer_rated"] = True
        self.jobs[job_id] = json.dumps(job)
        self._update_reputation(job["employer"], int(score))

    @gl.public.write
    def rate_contractor(self, job_id: str, score: i32) -> None:
        """
        Allows the employer to rate the contractor after job completion (1-5 stars).
        """
        if int(score) < 1 or int(score) > 5:
            raise gl.vm.UserError("Rating score must be between 1 and 5")
        
        job = json.loads(self.jobs[job_id])
        if job["status"] != 4:
            raise gl.vm.UserError("Ratings can only be submitted for completed jobs")
        if str(gl.message.sender_address) != job["employer"]:
            raise gl.vm.UserError("Only the employer can rate the contractor")
        if job["contractor_rated"]:
            raise gl.vm.UserError("You have already rated the contractor for this job")

        job["contractor_rated"] = True
        self.jobs[job_id] = json.dumps(job)
        self._update_reputation(job["contractor"], int(score))

    @gl.public.view
    def get_user_rating(self, address: str) -> str:
        """
        Returns JSON-encoded rating statistics for a given address.
        """
        try:
            return self.ratings[address]
        except Exception:
            return json.dumps({"total_score": 0, "count": 0, "average": 0.0})

    def _update_reputation(self, address: str, score: int) -> None:
        """
        Internal helper to update the average rating of a user address.
        """
        try:
            stats = json.loads(self.ratings[address])
        except Exception:
            stats = {"total_score": 0, "count": 0, "average": 0.0}

        stats["total_score"] += score
        stats["count"] += 1
        stats["average"] = round(float(stats["total_score"]) / stats["count"], 2)
        self.ratings[address] = json.dumps(stats)

    def _disburse_payment(self, recipient: str, amount: u256) -> None:
        """
        Inner helper to perform native token transfers.
        """
        @gl.evm.contract_interface
        class _RecipientAddress:
            class View:
                pass
            class Write:
                pass
        _RecipientAddress(Address(recipient)).emit_transfer(value=amount)

