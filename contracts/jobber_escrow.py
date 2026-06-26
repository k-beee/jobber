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
